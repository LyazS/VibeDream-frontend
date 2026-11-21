import { MediaStatusManager } from '@/core/datasource/services/MediaStatusService'
import { markRaw } from 'vue'
import { validateFile } from '@/core/utils/mediaTypeDetector'
import { hashFile } from '@/core/utils/hashFile'
import type { MediaTypeOrUnknown, UnifiedMediaItemData } from '@/core/mediaitem/types'
import { getLinkedHandle, type LinkedHandle, type LinkedProjectScope } from './LinkedMediaBindings'
import {
  splitLinkedRelativePath,
  type LinkedFileRecord,
  type LinkedMediaIssue,
} from './LinkedFileSource'

export const LINKED_MEDIA_MESSAGES: Record<LinkedMediaIssue, string> = {
  permission: '需要授权',
  unbound: '需要重新链接',
  missing: '原件缺失',
  changed: '原件已变化',
  protected: '工程托管目录中的文件和目录不能作为链接来源',
  unreadable: '无法读取原件',
  damaged: '链接素材记录损坏',
}

export class LinkedMediaError extends Error {
  constructor(
    readonly issue: LinkedMediaIssue,
    readonly originalError?: unknown,
  ) {
    super(LINKED_MEDIA_MESSAGES[issue])
    this.name = 'LinkedMediaError'
  }
}

export function toLinkedMediaError(error: unknown): LinkedMediaError {
  if (error instanceof LinkedMediaError) return error
  if (error instanceof Error) {
    if (error.name === 'NotFoundError' || error.name === 'TypeMismatchError') {
      return new LinkedMediaError('missing', error)
    }
    if (error.name === 'NotAllowedError' || error.name === 'SecurityError') {
      return new LinkedMediaError('permission', error)
    }
  }
  return new LinkedMediaError('unreadable', error)
}

export async function isManagedEntry(root: FileSystemDirectoryHandle | null, entry: LinkedHandle) {
  return root !== null && (await root.resolve(entry)) !== null
}

export async function assertExternalEntry(
  root: FileSystemDirectoryHandle | null,
  entry: LinkedHandle,
) {
  if (await isManagedEntry(root, entry)) throw new LinkedMediaError('protected')
}

export async function resolveLinkedFile(root: FileSystemDirectoryHandle, relativePath: string) {
  const parts = splitLinkedRelativePath(relativePath)
  const name = parts.pop()!
  let directory = root
  for (const part of parts) directory = await directory.getDirectoryHandle(part)
  return directory.getFileHandle(name)
}

export async function verifyLinkedContent(
  record: LinkedFileRecord,
  file: File,
  signal?: AbortSignal,
  mediaType?: MediaTypeOrUnknown,
) {
  if (mediaType !== undefined) {
    const validation = validateFile(file)
    if (!validation.isValid || validation.mediaType !== mediaType)
      throw new LinkedMediaError('changed')
  }
  if (file.size !== record.size) throw new LinkedMediaError('changed')
  if ((await hashFile(file, signal)) !== record.contentSha256) throw new LinkedMediaError('changed')
}

/** A restore or recovery batch queries each original handle's permission once. */
export function createLinkedMediaReader(
  scope: LinkedProjectScope,
  workspace: {
    readonly workspaceKey: string | null
    getManagedProjectsRoot(): Promise<FileSystemDirectoryHandle | null>
  },
) {
  const checks = new Map<string, Promise<{ handle: LinkedHandle; permission: PermissionState }>>()
  let managedRoot: Promise<FileSystemDirectoryHandle | null> | undefined
  function checkHandle(handleId: string) {
    let check = checks.get(handleId)
    if (!check) {
      check = (async () => {
        const handle = await getLinkedHandle(scope, handleId)
        if (!handle) throw new LinkedMediaError('unbound')
        return { handle, permission: await handle.queryPermission({ mode: 'read' }) }
      })()
      checks.set(handleId, check)
    }
    return check
  }

  async function read(media: UnifiedMediaItemData): Promise<File> {
    const source = media.source
    if (source.type !== 'linked-file') throw new Error('素材不是链接来源')
    delete source.permissionHandle
    try {
      if (!source.record) throw new LinkedMediaError('damaged')
      if (workspace.workspaceKey !== scope.workspaceKey) throw new Error('工作区已切换')
      const { handle, permission } = await checkHandle(source.record.handleId)
      if (workspace.workspaceKey !== scope.workspaceKey) throw new Error('工作区已切换')
      const guardRoot = await (managedRoot ??= workspace.getManagedProjectsRoot())
      await assertExternalEntry(guardRoot, handle)
      source.permissionHandle = markRaw(handle)
      if (permission !== 'granted') throw new LinkedMediaError('permission')
      const record = source.record
      let fileHandle: FileSystemFileHandle
      if (handle.kind === 'directory' && record.handleKind === 'directory') {
        fileHandle = await resolveLinkedFile(handle, record.relativePath)
      } else if (handle.kind === 'file' && record.handleKind === 'file') {
        fileHandle = handle
      } else {
        throw new LinkedMediaError('damaged')
      }
      if (fileHandle !== handle) await assertExternalEntry(guardRoot, fileHandle)
      const file = await fileHandle.getFile()
      if (file.size !== source.record.size) throw new LinkedMediaError('changed')
      return file
    } catch (error) {
      throw toLinkedMediaError(error)
    }
  }

  return { read }
}

export function setLinkedMediaIssue(media: UnifiedMediaItemData, error: unknown) {
  if (media.source.type !== 'linked-file') return
  const failure = toLinkedMediaError(error)
  media.source.issue = failure.issue
  media.source.errorMessage = failure.message
  delete media.source.checkedFile
  new MediaStatusManager().transitionTo(media, 'missing')
}

export function markLinkedMediaReadable(media: UnifiedMediaItemData, file: File) {
  if (media.source.type !== 'linked-file') return
  media.source.checkedFile = file
  delete media.source.issue
  delete media.source.errorMessage
  const status = new MediaStatusManager()
  if (media.mediaStatus === 'ready') status.transitionTo(media, 'pending')
  else if (media.mediaStatus !== 'pending') status.resetStatus(media)
}
