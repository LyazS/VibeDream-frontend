import type { IFileSystemAdapter, PermissionCheckResult, FileSystemEntry } from '../interfaces'
import type { WorkspaceInfo } from './types'
import { PathResolver } from './PathResolver'
import { FileSystemError } from '../errors/FileSystemError'
import { ErrorCode } from '../errors/ErrorCodes'

/**
 * 统一的文件系统服务
 * 通过适配器模式支持不同的存储后端
 */
export class FileSystemService {
  private adapter: IFileSystemAdapter
  private pathResolver: PathResolver

  constructor(adapter: IFileSystemAdapter) {
    // 在构造函数中检查适配器支持性
    if (!adapter.isSupported()) {
      throw new FileSystemError(
        `当前环境不支持 ${adapter.getName()} 适配器`,
        ErrorCode.NOT_SUPPORTED,
      )
    }

    this.adapter = adapter
    this.pathResolver = new PathResolver()
  }

  // ==================== 工作空间管理 ====================

  /**
   * 检查并确保工作空间访问权限
   * @param forcePrompt 是否强制弹窗选择
   */
  async checkPermission(forcePrompt?: boolean): Promise<PermissionCheckResult> {
    try {
      return await this.adapter.checkPermission(forcePrompt)
    } catch (error) {
      throw this.wrapError(error, '检查工作空间权限失败')
    }
  }

  /**
   * 获取工作空间信息
   */
  async getWorkspaceInfo(): Promise<WorkspaceInfo | null> {
    try {
      return await this.adapter.getWorkspaceInfo()
    } catch (error) {
      throw this.wrapError(error, '获取工作空间信息失败')
    }
  }

  // ==================== 文件操作（委托给适配器） ====================

  async readFile(path: string): Promise<string> {
    try {
      return await this.adapter.readFile(path)
    } catch (error) {
      throw this.wrapError(error, `读取文件失败: ${path}`, path)
    }
  }

  async readFileAsBlob(path: string): Promise<Blob> {
    try {
      return await this.adapter.readFileAsBlob(path)
    } catch (error) {
      throw this.wrapError(error, `读取文件失败: ${path}`, path)
    }
  }

  async writeFile(path: string, content: string | Blob): Promise<void> {
    try {
      await this.adapter.writeFile(path, content)
    } catch (error) {
      throw this.wrapError(error, `写入文件失败: ${path}`, path)
    }
  }

  async deleteFile(path: string): Promise<void> {
    try {
      await this.adapter.deleteFile(path)
    } catch (error) {
      throw this.wrapError(error, `删除文件失败: ${path}`, path)
    }
  }

  async fileExists(path: string): Promise<boolean> {
    try {
      return await this.adapter.fileExists(path)
    } catch (error) {
      throw this.wrapError(error, `检查文件是否存在失败: ${path}`, path)
    }
  }

  // ==================== 目录操作（委托给适配器） ====================

  async createDirectory(path: string): Promise<void> {
    try {
      await this.adapter.createDirectory(path)
    } catch (error) {
      throw this.wrapError(error, `创建目录失败: ${path}`, path)
    }
  }

  async deleteDirectory(path: string, recursive?: boolean): Promise<void> {
    try {
      await this.adapter.deleteDirectory(path, recursive)
    } catch (error) {
      throw this.wrapError(error, `删除目录失败: ${path}`, path)
    }
  }

  async listDirectory(path: string): Promise<FileSystemEntry[]> {
    try {
      return await this.adapter.listDirectory(path)
    } catch (error) {
      throw this.wrapError(error, `列出目录内容失败: ${path}`, path)
    }
  }

  async directoryExists(path: string): Promise<boolean> {
    try {
      return await this.adapter.directoryExists(path)
    } catch (error) {
      throw this.wrapError(error, `检查目录是否存在失败: ${path}`, path)
    }
  }

  // ==================== 批量操作（委托给适配器） ====================

  async readFiles(paths: string[]): Promise<Map<string, string>> {
    try {
      return await this.adapter.readFiles(paths)
    } catch (error) {
      throw this.wrapError(error, `批量读取文件失败`)
    }
  }

  async writeFiles(files: Map<string, string>): Promise<void> {
    try {
      await this.adapter.writeFiles(files)
    } catch (error) {
      throw this.wrapError(error, `批量写入文件失败`)
    }
  }

  // ==================== 高级操作（委托给适配器） ====================

  async copyFile(source: string, dest: string): Promise<void> {
    try {
      await this.adapter.copyFile(source, dest)
    } catch (error) {
      throw this.wrapError(error, `复制文件失败: ${source} -> ${dest}`, source)
    }
  }

  async moveFile(source: string, dest: string): Promise<void> {
    try {
      await this.adapter.moveFile(source, dest)
    } catch (error) {
      throw this.wrapError(error, `移动文件失败: ${source} -> ${dest}`, source)
    }
  }

  // ==================== 便捷方法 ====================

  async writeAgentAttachment(
    projectId: string,
    attachmentId: string,
    mimeType: string,
    original: Blob,
  ): Promise<string> {
    const path = this.paths.getAgentAttachmentPath(projectId, attachmentId, mimeType)
    await this.writeFile(path, original)
    return path
  }

  async readAgentAttachment(projectId: string, attachmentId: string, path: string): Promise<Blob> {
    this.paths.assertAgentAttachmentPath(projectId, attachmentId, path)
    return this.readFileAsBlob(path)
  }

  async deleteAgentAttachment(
    projectId: string,
    attachmentId: string,
    path: string,
  ): Promise<void> {
    this.paths.assertAgentAttachmentPath(projectId, attachmentId, path)
    await this.deleteFile(path)
  }

  /**
   * 获取路径解析器
   */
  get paths(): PathResolver {
    return this.pathResolver
  }

  /**
   * 获取当前适配器名称
   */
  getAdapterName(): string {
    return this.adapter.getName()
  }

  /**
   * 检查适配器是否支持
   */
  isSupported(): boolean {
    return this.adapter.isSupported()
  }

  // ==================== 错误处理 ====================

  private wrapError(error: unknown, message: string, path?: string): FileSystemError {
    if (error instanceof FileSystemError) {
      return error
    }

    const cause = error instanceof Error ? error : new Error(String(error))
    return new FileSystemError(message, ErrorCode.OPERATION_FAILED, path, cause)
  }
}
