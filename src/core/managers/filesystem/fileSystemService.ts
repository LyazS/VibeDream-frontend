import { FileSystemService } from '@/core/filesystem/core/FileSystemService'
import { createFileSystemAdapter } from '@/core/filesystem/createFileSystemAdapter'

/**
 * 创建适配器
 */
const adapter = createFileSystemAdapter(import.meta.env)

/**
 * 创建并导出文件系统服务单例
 */
export const fileSystemService = new FileSystemService(adapter)
