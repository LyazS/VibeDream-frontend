import type { useUnifiedStore } from '@/core/unifiedStore'
import type { UnifiedMediaItemData } from '@/core/mediaitem/types'
import { fileSystemService } from '@/core/managers/filesystem/fileSystemService'
import { globalMetaFileManager } from '@/core/managers/media/globalMetaFileManager'
import {
  createLinkedFileSource,
  type LinkedFileRecord,
  type LinkedMediaIssue,
} from './LinkedFileSource'
import {
  registerLinkedHandle,
  withLinkedProjectLock,
  type LinkedHandle,
} from './LinkedMediaBindings'
import {
  assertExternalEntry,
  createLinkedMediaReader,
  LinkedMediaError,
  resolveLinkedFile,
  setLinkedMediaIssue,
  toLinkedMediaError,
  verifyLinkedContent,
} from './LinkedMediaReader'

type RecoveryStore = Pick<
  ReturnType<typeof useUnifiedStore>,
  'projectId' | 'getMediaItem' | 'getAllMediaItems' | 'reloadLinkedMedia'
>

interface RecoveryResult {
  name: string
  issue?: LinkedMediaIssue | 'recoveryFailed'
}

export interface LinkedRecoveryProgress {
  current: number
  total: number
}

type RecoveryProgressHandler = (progress: LinkedRecoveryProgress) => void

function createRecovery(store: RecoveryStore, media: UnifiedMediaItemData, signal?: AbortSignal) {
  const context = globalMetaFileManager.contextForAsset(media)
  if (!context.workspaceKey) throw new Error('工作区不可用')
  if (media.source.type !== 'linked-file' || !media.source.record)
    throw new LinkedMediaError('damaged')
  const scope = { projectId: context.projectId, workspaceKey: context.workspaceKey }
  const { handleId } = media.source.record
  const group = store
    .getAllMediaItems()
    .filter(
      (item) => item.source.type === 'linked-file' && item.source.record?.handleId === handleId,
    )
  function assertActive(item = media) {
    signal?.throwIfAborted()
    context.assertActive?.()
    globalMetaFileManager.assertAssetActive(item)
    if (store.projectId !== scope.projectId || store.getMediaItem(item.id) !== item) {
      throw new Error('素材所属工程已切换')
    }
  }
  assertActive()
  return { context, scope, group, assertActive, source: media.source }
}

export async function reauthorizeLinkedMedia(
  store: RecoveryStore,
  media: UnifiedMediaItemData,
  signal?: AbortSignal,
  onProgress?: RecoveryProgressHandler,
) {
  const { context, scope, group, assertActive, source } = createRecovery(store, media, signal)
  if (!source.permissionHandle) throw new LinkedMediaError('unbound')
  // Call immediately from the click handler while the user activation is available.
  if ((await source.permissionHandle.requestPermission({ mode: 'read' })) !== 'granted') {
    throw new LinkedMediaError('permission')
  }
  const linkedReader = createLinkedMediaReader(scope, fileSystemService)
  const results: RecoveryResult[] = []
  onProgress?.({ current: 0, total: group.length })
  for (const [index, item] of group.entries()) {
    assertActive(item)
    try {
      const file = await globalMetaFileManager.loadMediaFile(item, {
        linkedReader,
        context,
        signal,
      })
      assertActive(item)
      if (item.mediaStatus !== 'ready') await store.reloadLinkedMedia(item, file)
      results.push({ name: item.name })
    } catch (error) {
      assertActive(item)
      setLinkedMediaIssue(item, error)
      results.push({ name: item.name, issue: toLinkedMediaError(error).issue })
    } finally {
      onProgress?.({ current: index + 1, total: group.length })
    }
  }
  return results
}

export async function relinkMediaFromPicker(
  store: RecoveryStore,
  media: UnifiedMediaItemData,
  kind: LinkedHandle['kind'],
  signal?: AbortSignal,
  onProgress?: RecoveryProgressHandler,
) {
  const { context, scope, group, assertActive } = createRecovery(store, media, signal)
  const handle =
    kind === 'directory'
      ? await window.showDirectoryPicker({ mode: 'read' })
      : (await window.showOpenFilePicker({ multiple: false }))[0]
  if (!handle) return []
  assertActive()
  const managedRoot = await fileSystemService.getManagedProjectsRoot()
  await assertExternalEntry(managedRoot, handle)
  const handleId = crypto.randomUUID()
  const results: RecoveryResult[] = []
  const items = handle.kind === 'directory' ? group : [media]
  onProgress?.({ current: 0, total: items.length })
  let registered = false
  try {
    for (const [index, item] of items.entries()) {
      assertActive(item)
      if (item.source.type !== 'linked-file' || !item.source.record) {
        onProgress?.({ current: index + 1, total: items.length })
        continue
      }
      const previous = item.source
      const record = item.source.record
      const label = record.handleKind === 'directory' ? record.relativePath : item.name
      try {
        const fileHandle =
          handle.kind === 'directory' && record.handleKind === 'directory'
            ? await resolveLinkedFile(handle, record.relativePath)
            : handle
        if (fileHandle.kind !== 'file') throw new LinkedMediaError('damaged')
        await assertExternalEntry(managedRoot, fileHandle)
        const file = await fileHandle.getFile()
        await verifyLinkedContent(record, file, signal, item.mediaType)
        const identity = {
          type: record.type,
          handleId,
          size: record.size,
          contentSha256: record.contentSha256,
        }
        const nextRecord: LinkedFileRecord =
          handle.kind === 'directory' && record.handleKind === 'directory'
            ? { ...identity, handleKind: 'directory', relativePath: record.relativePath }
            : { ...identity, handleKind: 'file' }
        const source = createLinkedFileSource(nextRecord)
        await withLinkedProjectLock(scope, async () => {
          assertActive(item)
          if (previous !== item.source) throw new Error('链接来源已更新')
          if (
            !(await fileSystemService.directoryExists(
              fileSystemService.paths.getProjectPath(scope.projectId),
            ))
          ) {
            throw new Error('工程已删除')
          }
          assertActive(item)
          await registerLinkedHandle(scope, handleId, handle)
          registered = true
          const saved = await globalMetaFileManager.saveMetaFile(
            item,
            {
              ...context,
              assertActive: () => assertActive(item),
            },
            {
              source,
              onCommitted: () => {
                item.source = source
              },
            },
          )
          if (!saved) throw new Error('链接素材记录保存失败')
        })
        assertActive(item)
        await store.reloadLinkedMedia(item, file)
        results.push({ name: label })
      } catch (error) {
        assertActive(item)
        const failure = error instanceof DOMException ? toLinkedMediaError(error) : error
        if (!(failure instanceof LinkedMediaError))
          console.error('[LinkedMedia] Relink failed:', error)
        results.push({
          name: label,
          issue: failure instanceof LinkedMediaError ? failure.issue : 'recoveryFailed',
        })
      } finally {
        onProgress?.({ current: index + 1, total: items.length })
      }
    }
  } finally {
    if (registered) {
      await withLinkedProjectLock(scope, () =>
        globalMetaFileManager.reconcileLinkedHandles(scope, context),
      ).catch((error) => {
        console.warn('链接句柄回收将延后到下次打开工程', error)
      })
    }
  }
  return results
}
