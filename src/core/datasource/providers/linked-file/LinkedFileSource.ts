import {
  RuntimeStateFactory,
  SourceOrigin,
  type DataSourceRuntimeState,
} from '@/core/datasource/core/BaseDataSource'

interface LinkedFileIdentity {
  type: 'linked-file'
  handleId: string
  size: number
  contentSha256: string
}

export type LinkedFileRecord = LinkedFileIdentity &
  ({ handleKind: 'file' } | { handleKind: 'directory'; relativePath: string })

export type LinkedMediaIssue =
  | 'permission'
  | 'unbound'
  | 'missing'
  | 'changed'
  | 'protected'
  | 'unreadable'
  | 'damaged'

export interface LinkedFileSourceData extends DataSourceRuntimeState {
  type: 'linked-file'
  /** Undefined when the on-disk record failed validation. */
  record?: LinkedFileRecord
  checkedFile?: File
  issue?: LinkedMediaIssue
  permissionHandle?: FileSystemFileHandle | FileSystemDirectoryHandle
}

export function createLinkedFileSource(record?: LinkedFileRecord): LinkedFileSourceData {
  return {
    type: 'linked-file',
    record,
    ...RuntimeStateFactory.createRuntimeState(SourceOrigin.PROJECT_LOAD),
  }
}

export function splitLinkedRelativePath(path: string): string[] {
  const parts = path.split('/')
  if (parts.some((part) => part === '' || part === '.' || part === '..' || part.includes('\0'))) {
    throw new Error('无效的链接相对路径')
  }
  return parts
}

export function isLinkedFileRecord(value: unknown): value is LinkedFileRecord {
  if (!value || typeof value !== 'object') return false
  const record = value as Record<string, unknown>
  if (
    record.type !== 'linked-file' ||
    typeof record.handleId !== 'string' ||
    !record.handleId ||
    typeof record.size !== 'number' ||
    !Number.isSafeInteger(record.size) ||
    record.size < 0 ||
    typeof record.contentSha256 !== 'string' ||
    !/^[a-f0-9]{64}$/.test(record.contentSha256)
  )
    return false

  if (record.handleKind === 'file') return record.relativePath === undefined
  if (record.handleKind !== 'directory' || typeof record.relativePath !== 'string') return false
  try {
    splitLinkedRelativePath(record.relativePath)
    return true
  } catch {
    return false
  }
}

export function extractLinkedFileRecord(source: LinkedFileSourceData): LinkedFileRecord {
  const record = source.record
  if (!record) throw new Error('链接素材记录损坏')
  const { type, handleId, size, contentSha256 } = record
  const identity = { type, handleId, size, contentSha256 }
  return record.handleKind === 'directory'
    ? { ...identity, handleKind: 'directory', relativePath: record.relativePath }
    : { ...identity, handleKind: 'file' }
}
