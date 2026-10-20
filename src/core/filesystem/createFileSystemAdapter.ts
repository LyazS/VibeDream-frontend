import type { IFileSystemAdapter } from './interfaces'
import { FileSystemAccessAdapter } from './adapters/FileSystemAccessAdapter'
import { OPFSAdapter } from './adapters/OPFSAdapter'

export interface FileSystemAdapterConfig {
  VITE_FILE_SYSTEM_ADAPTER?: string
  VITE_OPFS_WORKSPACE_ID?: string
}

/** 在页面启动时选择存储后端，不根据运行环境推断，不在失败时切换工作空间。 */
export function createFileSystemAdapter(config: FileSystemAdapterConfig): IFileSystemAdapter {
  const name = config.VITE_FILE_SYSTEM_ADAPTER
  if (!name) throw new Error('必须配置 VITE_FILE_SYSTEM_ADAPTER')
  if (name === 'file-system-access') return new FileSystemAccessAdapter()
  if (name === 'opfs') {
    const workspaceId = config.VITE_OPFS_WORKSPACE_ID
    if (workspaceId === undefined) throw new Error('使用 OPFS 时必须配置 VITE_OPFS_WORKSPACE_ID')
    return new OPFSAdapter({ workspaceId })
  }
  throw new Error(`未知文件系统适配器配置: ${name}`)
}
