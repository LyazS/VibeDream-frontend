import { withStorageLock } from '@/core/storage/withStorageLock'
import type { IFileSystemAdapter, PermissionCheckResult, FileSystemEntry } from '../interfaces'
import type { WorkspaceInfo } from './types'
import { PathResolver } from './PathResolver'
import { FileSystemError } from '../errors/FileSystemError'
import { ErrorCode } from '../errors/ErrorCodes'

export interface ProjectWriteOptions {
  workspaceKey: string | null
  assertActive?: () => void
}

/**
 * 统一的文件系统服务
 * 通过适配器模式支持不同的存储后端
 */
export class FileSystemService {
  private adapter: IFileSystemAdapter
  private pathResolver: PathResolver
  private readonly deletingProjects = new Set<string>()

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

  get workspaceKey(): string | null {
    return this.adapter.getWorkspaceKey?.() ?? null
  }

  async getManagedProjectsRoot(): Promise<FileSystemDirectoryHandle | null> {
    return (await this.adapter.getManagedProjectsRoot?.()) ?? null
  }

  /** Queued filesystem mutations recheck the workspace and directory after acquiring the lock. */
  private async mutateProjectPath<T>(
    path: string,
    run: (assertWritable: () => void) => Promise<T>,
    options?: ProjectWriteOptions,
    rootOperation?: 'create' | 'delete',
  ): Promise<T> {
    const [root, projectId, ...parts] = path.split('/').filter(Boolean)
    if (root !== 'projects' || !projectId || !this.adapter.getWorkspaceKey)
      return run(() => options?.assertActive?.())

    const workspaceKey = options ? options.workspaceKey : this.workspaceKey
    const assertActive = () => {
      if (!workspaceKey || workspaceKey !== this.workspaceKey) throw new Error('工作区已切换')
      options?.assertActive?.()
    }
    const lockKey = `project-files:${JSON.stringify([workspaceKey, projectId])}`
    const assertWritable = () => {
      assertActive()
      if (this.deletingProjects.has(lockKey)) throw new Error('工程正在删除')
    }
    assertWritable()
    const deletesProject = rootOperation === 'delete' && parts.length === 0
    if (deletesProject) this.deletingProjects.add(lockKey)
    try {
      return await withStorageLock(lockKey, async () => {
        assertActive()
        if (!(rootOperation === 'create' && parts.length === 0) && !deletesProject) {
          if (this.deletingProjects.has(lockKey)) throw new Error('工程正在删除')
          if (!(await this.adapter.directoryExists(this.paths.getProjectPath(projectId)))) {
            throw new Error('工程目录不存在')
          }
          assertWritable()
        }
        return run(assertWritable)
      })
    } finally {
      if (deletesProject) this.deletingProjects.delete(lockKey)
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

  async writeFile(
    path: string,
    content: string | Blob,
    options?: ProjectWriteOptions,
  ): Promise<void> {
    try {
      await this.mutateProjectPath(path, () => this.adapter.writeFile(path, content), options)
    } catch (error) {
      throw this.wrapError(error, `写入文件失败: ${path}`, path)
    }
  }

  /** Publish the new source before queued writes can run. */
  async commitLinkedMediaMeta(
    path: string,
    content: string,
    options: ProjectWriteOptions,
    commit: 'create' | { onCommitted: () => void },
  ): Promise<void> {
    try {
      await this.mutateProjectPath(
        path,
        async (assertWritable) => {
          if (commit === 'create') {
            if (await this.adapter.fileExists(path)) throw new Error('目标文件已存在')
            assertWritable()
          }

          try {
            await this.adapter.writeFile(path, content)
          } catch (error) {
            if (commit === 'create')
              await this.removeEmptyMetaAfterFailedCreate(path, options.workspaceKey)
            throw error
          }
          if (commit !== 'create') commit.onCommitted()
        },
        options,
      )
    } catch (error) {
      throw this.wrapError(error, `写入文件失败: ${path}`, path)
    }
  }

  private async removeEmptyMetaAfterFailedCreate(path: string, workspaceKey: string | null) {
    // An uncertain close can leave a committed record. Only remove confirmed empty files.
    try {
      if (workspaceKey !== this.workspaceKey) return
      const file = await this.adapter.readFileAsBlob(path)
      if (file.size === 0 && workspaceKey === this.workspaceKey) await this.adapter.deleteFile(path)
    } catch {
      // Leave the record for reconciliation if the filesystem cannot confirm the outcome.
    }
  }

  async deleteFile(path: string, options?: ProjectWriteOptions): Promise<void> {
    try {
      await this.mutateProjectPath(path, () => this.adapter.deleteFile(path), options)
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

  async createDirectory(path: string, options?: ProjectWriteOptions): Promise<void> {
    try {
      await this.mutateProjectPath(
        path,
        () => this.adapter.createDirectory(path),
        options,
        'create',
      )
    } catch (error) {
      throw this.wrapError(error, `创建目录失败: ${path}`, path)
    }
  }

  async deleteDirectory(
    path: string,
    recursive?: boolean,
    options?: ProjectWriteOptions,
  ): Promise<void> {
    try {
      await this.mutateProjectPath(
        path,
        () => this.adapter.deleteDirectory(path, recursive),
        options,
        'delete',
      )
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
      const options = { workspaceKey: this.workspaceKey }
      await Promise.all([...files].map(([path, content]) => this.writeFile(path, content, options)))
    } catch (error) {
      throw this.wrapError(error, `批量写入文件失败`)
    }
  }

  // ==================== 高级操作（委托给适配器） ====================

  async copyFile(source: string, dest: string): Promise<void> {
    try {
      await this.mutateProjectPath(dest, () => this.adapter.copyFile(source, dest))
    } catch (error) {
      throw this.wrapError(error, `复制文件失败: ${source} -> ${dest}`, source)
    }
  }

  async moveFile(source: string, dest: string): Promise<void> {
    try {
      await this.mutateProjectPath(dest, () => this.adapter.moveFile(source, dest))
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
