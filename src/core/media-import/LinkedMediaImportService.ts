import type { useUnifiedStore } from '@/core/unifiedStore'
import { BunnyProcessor, disposeBunnyObjects } from '@/core/bunnyUtils/BunnyProcessor'
import {
  createLinkedFileSource,
  splitLinkedRelativePath,
  type LinkedFileRecord,
} from '@/core/datasource/providers/linked-file/LinkedFileSource'
import {
  getLinkedHandle,
  registerLinkedHandle,
  withLinkedProjectLock,
  type LinkedHandle,
} from '@/core/datasource/providers/linked-file/LinkedMediaBindings'
import {
  assertExternalEntry,
  isManagedEntry,
  LinkedMediaError,
} from '@/core/datasource/providers/linked-file/LinkedMediaReader'
import { fileSystemService } from '@/core/managers/filesystem/fileSystemService'
import { globalMetaFileManager } from '@/core/managers/media/globalMetaFileManager'
import { createUnifiedMediaItemData } from '@/core/mediaitem/types'
import { hashFile } from '@/core/utils/hashFile'
import { generateMediaId } from '@/core/utils/idGenerator'
import { extractExtension } from '@/core/utils/mediaPathUtils'
import { validateFile, type FileValidationFailure } from '@/core/utils/mediaTypeDetector'
import { allocateCopyName } from './DirectoryImportExecutor'
import type { ImportMediaType } from './types'

type LinkedImportStore = Pick<
  ReturnType<typeof useUnifiedStore>,
  | 'projectId'
  | 'getDirectory'
  | 'getAllDirectories'
  | 'createDirectory'
  | 'saveCurrentProject'
  | 'addMediaItem'
  | 'registerAssetLocation'
>

interface Candidate {
  handle: FileSystemFileHandle
  root: LinkedHandle
  rootId: string
  path: string[]
}

export interface LinkedImportProgress {
  phase: 'discovering' | 'screening' | 'processing'
  current: number
  total: number
}

interface LinkedImportOptions {
  /** Stop admitting work but let the current files commit. */
  stop: AbortSignal
  /** The owning library session is gone. Abort hashes and prevent further writes. */
  signal: AbortSignal
  onProgress: (progress: LinkedImportProgress) => void
}

type ImportProblem = { path: string; message: string } & (
  | { reason: 'invalid'; validation: FileValidationFailure }
  | { reason: 'protected' | 'unreadable-directory' | 'unreadable-file' | 'failed' }
)

const processor = new BunnyProcessor()

async function forEachConcurrent<T>(
  items: readonly T[],
  stop: () => boolean,
  run: (item: T) => Promise<void>,
) {
  let next = 0
  async function worker() {
    while (next < items.length && !stop()) await run(items[next++]!)
  }
  await Promise.all([worker(), worker()])
  return next
}

export async function importLinkedMedia(
  store: LinkedImportStore,
  roots: LinkedHandle[],
  targetDirectoryId: string,
  { stop, signal, onProgress }: LinkedImportOptions,
) {
  const context = globalMetaFileManager.captureContext()
  const { projectId, workspaceKey } = context
  if (!workspaceKey) throw new Error('工作区不可用')
  const scope = { projectId, workspaceKey }
  const assertActive = () => {
    signal.throwIfAborted()
    context.assertActive?.()
    if (store.projectId !== projectId) throw new Error('工程已切换')
    if (!store.getDirectory(targetDirectoryId)) throw new Error('目标素材目录已删除')
  }
  async function assertProjectExists() {
    assertActive()
    const path = fileSystemService.paths.getProjectPath(projectId)
    if (!(await fileSystemService.directoryExists(path))) throw new Error('工程已删除')
  }
  const stopped = () => stop.aborted || signal.aborted
  assertActive()
  onProgress({ phase: 'discovering', current: 0, total: 0 })
  const managed = await fileSystemService.getManagedProjectsRoot()
  const problems: ImportProblem[] = []
  const candidates: Candidate[] = []
  let discovered = 0

  async function discover(
    handle: LinkedHandle,
    root: LinkedHandle,
    rootId: string,
    path: string[],
  ) {
    if (stopped()) return
    assertActive()
    onProgress({ phase: 'discovering', current: ++discovered, total: 0 })
    let protectedEntry: boolean
    try {
      protectedEntry = await isManagedEntry(managed, handle)
    } catch (error) {
      problems.push({
        path: path.join('/'),
        reason: handle.kind === 'file' ? 'unreadable-file' : 'unreadable-directory',
        message: describe(error),
      })
      return
    }
    if (protectedEntry) {
      problems.push({
        path: path.join('/'),
        reason: 'protected',
        message: new LinkedMediaError('protected').message,
      })
      return
    }
    if (handle.kind === 'file') {
      candidates.push({ handle, root, rootId, path })
      return
    }
    try {
      for await (const [name, child] of handle.entries()) {
        if (stopped()) break
        await discover(child, root, rootId, [...path, name])
      }
    } catch (error) {
      if (!stopped())
        problems.push({
          path: path.join('/'),
          reason: 'unreadable-directory',
          message: describe(error),
        })
    }
  }

  for (const root of roots) {
    await discover(root, root, crypto.randomUUID(), [root.name])
    if (stopped()) break
  }

  // getFile obtains a snapshot and its metadata. Byte reads and decode use the same snapshot.
  const accepted: { entry: Candidate; file: File; mediaType: ImportMediaType }[] = []
  let screened = 0
  onProgress({ phase: 'screening', current: 0, total: candidates.length })
  const attempted = await forEachConcurrent(candidates, stopped, async (entry) => {
    try {
      const file = await entry.handle.getFile()
      const validation = validateFile(file)
      if (!validation.isValid) {
        problems.push({
          path: entry.path.join('/'),
          reason: 'invalid',
          validation: validation.failure,
          message: validation.errorMessage,
        })
      } else {
        accepted.push({ entry, file, mediaType: validation.mediaType })
      }
    } catch (error) {
      problems.push({
        path: entry.path.join('/'),
        reason: 'unreadable-file',
        message: describe(error),
      })
    } finally {
      onProgress({ phase: 'screening', current: ++screened, total: candidates.length })
    }
  })

  const directoryIds = new Map<string, string>()
  let completed = 0
  let succeeded = 0
  onProgress({ phase: 'processing', current: 0, total: accepted.length })
  const started = await forEachConcurrent(accepted, stopped, async ({ entry, file, mediaType }) => {
    const path = entry.path.join('/')
    const directoryLink = entry.root.kind === 'directory'
    const relativePath = entry.path.slice(1).join('/')
    let published = false
    let media: ReturnType<typeof createUnifiedMediaItemData> | undefined
    try {
      assertActive()
      if (directoryLink) splitLinkedRelativePath(relativePath)
      const identity = {
        type: 'linked-file' as const,
        handleId: entry.rootId,
        size: file.size,
        contentSha256: await hashFile(file, signal),
      }
      const record: LinkedFileRecord = directoryLink
        ? { ...identity, handleKind: 'directory', relativePath }
        : { ...identity, handleKind: 'file' }
      const source = createLinkedFileSource(record)
      const item = createUnifiedMediaItemData(generateMediaId(), file.name, source, {
        ext: extractExtension(file.name),
        parentDirectoryId: targetDirectoryId,
        mediaType,
      })
      media = item
      const decoded = await processor.processMedia(item, file)
      item.duration = Number(decoded.durationN)
      item.mediaStatus = 'ready'
      item.source.progress = 100

      await withLinkedProjectLock(scope, async () => {
        await assertProjectExists()
        assertActive()
        const managedRoot = await fileSystemService.getManagedProjectsRoot()
        await assertExternalEntry(managedRoot, entry.root)
        if (entry.root !== entry.handle) await assertExternalEntry(managedRoot, entry.handle)
        assertActive()
        item.parentDirectoryId = ensureDirectories(entry)
        // Always await the directory snapshot, including when a preceding attempt failed to save it.
        await store.saveCurrentProject({ directoryChanged: true })
        assertActive()
        if (!(await getLinkedHandle(scope, entry.rootId))) {
          assertActive()
          await registerLinkedHandle(scope, entry.rootId, entry.root)
        }
        const assertCommitActive = () => {
          assertActive()
          if (!store.getDirectory(item.parentDirectoryId)) throw new Error('素材目录已删除')
        }
        const persisted = await globalMetaFileManager.saveMetaFile(
          item,
          { ...context, assertActive: assertCommitActive },
          { source, initial: true },
        )
        if (!persisted) {
          await globalMetaFileManager.reconcileLinkedHandles(scope, context).catch(() => {})
          throw new Error('链接素材记录保存失败')
        }
        await assertProjectExists()
        assertActive()
        if (!store.getDirectory(item.parentDirectoryId)) {
          await fileSystemService.deleteFile(
            fileSystemService.paths.getMetaPath(projectId, item.id),
            { workspaceKey, assertActive },
          )
          await globalMetaFileManager.reconcileLinkedHandles(scope, context).catch(() => {})
          throw new Error('素材目录已删除')
        }
        store.addMediaItem(item)
        published = true
        const location = store.registerAssetLocation(item.id)
        if (!location.success) throw new Error(location.error ?? '无法登记素材目录')
        succeeded++
      })
    } catch (error) {
      problems.push({ path, reason: 'failed', message: describe(error) })
    } finally {
      if (!published) await disposeBunnyObjects(media?.runtime.bunny).catch(() => {})
      onProgress({ phase: 'processing', current: ++completed, total: accepted.length })
    }
  })

  function ensureDirectories(entry: Candidate) {
    let parentId = targetDirectoryId
    const path: string[] = []
    for (const name of entry.path.slice(0, -1)) {
      path.push(name)
      const key = JSON.stringify([entry.rootId, ...path])
      const existing = directoryIds.get(key)
      if (existing && store.getDirectory(existing)) {
        parentId = existing
        continue
      }
      const siblings = new Set(
        store
          .getAllDirectories()
          .filter((dir) => dir.parentId === parentId)
          .map((dir) => dir.name),
      )
      const result = store.createDirectory(allocateCopyName(name.trim(), siblings), parentId)
      if (!result.success) throw new Error(result.error)
      parentId = result.directory.id
      directoryIds.set(key, parentId)
    }
    return parentId
  }

  return {
    succeeded,
    problems,
    notStarted: candidates.length - attempted + accepted.length - started,
  }
}

function describe(error: unknown) {
  return error instanceof Error ? error.message : String(error)
}
