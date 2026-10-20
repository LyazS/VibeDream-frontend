// 接口
export type { IFileSystemAdapter, PermissionCheckResult, FileSystemEntry } from './interfaces'

// 核心服务
export { FileSystemService } from './core/FileSystemService'
export { PathResolver } from './core/PathResolver'
export type { ParsedPath, WorkspaceInfo } from './core/types'
export { createFileSystemAdapter } from './createFileSystemAdapter'

// 错误处理
export { FileSystemError } from './errors/FileSystemError'
export { ErrorCode } from './errors/ErrorCodes'

// 适配器
export { FileSystemAccessAdapter, OPFSAdapter, type OPFSAdapterOptions } from './adapters'
