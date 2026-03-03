import type { IFileSystemAdapter, PermissionCheckResult, FileSystemEntry } from '../interfaces'
import type { WorkspaceInfo } from '../core/types'
import { FileSystemError } from '../errors/FileSystemError'
import { ErrorCode } from '../errors/ErrorCodes'
import { indexedDBService } from '@/core/storage/IndexedDBService'

/**
 * File System Access API 适配器（内置权限管理）
 * 实现 IFileSystemAdapter 接口
 */
export class FileSystemAccessAdapter implements IFileSystemAdapter {
  private workspaceHandle: FileSystemDirectoryHandle | null = null
  private readonly STORAGE_KEY = 'workspace_directory_handle'
  private readonly STORE_NAME = 'handles'

  // ==================== 实现接口方法 ====================

  getName(): string {
    return 'FileSystemAccess'
  }

  isSupported(): boolean {
    return 'showDirectoryPicker' in window && 'FileSystemDirectoryHandle' in window
  }

  /**
   * 检查并确保工作空间访问权限
   */
  async checkPermission(forcePrompt: boolean = false): Promise<PermissionCheckResult> {
    const hadAccessBefore = this.workspaceHandle !== null

    // 1. 如果强制弹窗，直接跳到选择步骤
    if (forcePrompt) {
      const success = await this.promptUserToSelectWorkspace()
      return {
        hasAccess: success,
        accessChanged: success !== hadAccessBefore,
      }
    }

    // 2. 检查内存中的句柄
    if (this.workspaceHandle) {
      const hasPermission = await this.verifyPermission(this.workspaceHandle)
      if (hasPermission) {
        return {
          hasAccess: true,
          accessChanged: false,
        }
      }
      // 权限失效，清除句柄
      this.workspaceHandle = null
    }

    // 3. 尝试从 IndexedDB 恢复句柄
    const restoredHandle = await this.restoreHandleFromDB()
    if (restoredHandle) {
      const hasPermission = await this.verifyPermission(restoredHandle)
      if (hasPermission) {
        this.workspaceHandle = restoredHandle
        return {
          hasAccess: true,
          accessChanged: !hadAccessBefore,
        }
      }
      // 恢复的句柄无效，清除存储
      await this.clearHandleFromDB()
    }

    // 4. 返回无权限状态，不自动弹窗
    return {
      hasAccess: false,
      accessChanged: hadAccessBefore, // 从有权限变为无权限
    }
  }

  /**
   * 获取工作空间信息
   */
  async getWorkspaceInfo(): Promise<WorkspaceInfo | null> {
    if (!this.workspaceHandle) {
      // 尝试恢复句柄
      const result = await this.checkPermission()
      if (!result.hasAccess) {
        return null
      }
    }

    return {
      name: this.workspaceHandle!.name,
      path: undefined, // File System Access API 不提供完整路径
    }
  }

  // ==================== 文件操作实现 ====================

  async readFile(path: string): Promise<string> {
    const fileHandle = await this.getFileHandle(path)
    const file = await fileHandle.getFile()
    return await file.text()
  }

  async readFileAsBlob(path: string): Promise<Blob> {
    const fileHandle = await this.getFileHandle(path)
    return await fileHandle.getFile()
  }

  async writeFile(path: string, content: string | Blob): Promise<void> {
    const fileHandle = await this.getFileHandle(path, { create: true })
    const writable = await fileHandle.createWritable()
    try {
      await writable.write(content)
      await writable.close()
    } catch (error) {
      await writable.abort()
      throw error
    }
  }

  async deleteFile(path: string): Promise<void> {
    await this.ensureWorkspaceHandle()
    const pathParts = path.split('/').filter((p) => p)

    if (pathParts.length === 0) {
      throw new FileSystemError('无效的文件路径', ErrorCode.INVALID_PATH, path)
    }

    let currentHandle: FileSystemDirectoryHandle = this.workspaceHandle!

    // 遍历到父目录
    for (let i = 0; i < pathParts.length - 1; i++) {
      try {
        currentHandle = await currentHandle.getDirectoryHandle(pathParts[i])
      } catch (error) {
        throw new FileSystemError(
          `目录不存在: ${pathParts.slice(0, i + 1).join('/')}`,
          ErrorCode.DIRECTORY_NOT_FOUND,
          path,
          error instanceof Error ? error : undefined,
        )
      }
    }

    // 删除文件
    const fileName = pathParts[pathParts.length - 1]
    try {
      await currentHandle.removeEntry(fileName)
    } catch (error) {
      throw new FileSystemError(
        `删除文件失败: ${fileName}`,
        ErrorCode.OPERATION_FAILED,
        path,
        error instanceof Error ? error : undefined,
      )
    }
  }

  async fileExists(path: string): Promise<boolean> {
    try {
      await this.getFileHandle(path)
      return true
    } catch (error) {
      if (error instanceof FileSystemError && error.code === ErrorCode.FILE_NOT_FOUND) {
        return false
      }
      throw error
    }
  }

  // ==================== 目录操作实现 ====================

  async createDirectory(path: string): Promise<void> {
    await this.ensureWorkspaceHandle()
    const pathParts = path.split('/').filter((p) => p)

    let currentHandle: FileSystemDirectoryHandle = this.workspaceHandle!

    // 递归创建目录
    for (const part of pathParts) {
      try {
        currentHandle = await currentHandle.getDirectoryHandle(part, { create: true })
      } catch (error) {
        // 如果是 NotFoundError，说明工作空间句柄已失效（目录被删除/移动）
        // 需要清除失效的句柄，让用户重新选择工作目录
        if (error instanceof Error && error.name === 'NotFoundError') {
          this.workspaceHandle = null
          await this.clearHandleFromDB()
          throw new FileSystemError(
            '工作目录已失效，请重新选择工作目录',
            ErrorCode.PERMISSION_DENIED,
            path,
            error,
          )
        }
        throw new FileSystemError(
          `创建目录失败: ${part}`,
          ErrorCode.OPERATION_FAILED,
          path,
          error instanceof Error ? error : undefined,
        )
      }
    }
  }

  async deleteDirectory(path: string, recursive: boolean = false): Promise<void> {
    await this.ensureWorkspaceHandle()
    const pathParts = path.split('/').filter((p) => p)

    if (pathParts.length === 0) {
      throw new FileSystemError('无效的目录路径', ErrorCode.INVALID_PATH, path)
    }

    let currentHandle: FileSystemDirectoryHandle = this.workspaceHandle!

    // 遍历到父目录
    for (let i = 0; i < pathParts.length - 1; i++) {
      try {
        currentHandle = await currentHandle.getDirectoryHandle(pathParts[i])
      } catch (error) {
        throw new FileSystemError(
          `目录不存在: ${pathParts.slice(0, i + 1).join('/')}`,
          ErrorCode.DIRECTORY_NOT_FOUND,
          path,
          error instanceof Error ? error : undefined,
        )
      }
    }

    // 删除目录
    const dirName = pathParts[pathParts.length - 1]
    try {
      await currentHandle.removeEntry(dirName, { recursive })
    } catch (error) {
      throw new FileSystemError(
        `删除目录失败: ${dirName}`,
        ErrorCode.OPERATION_FAILED,
        path,
        error instanceof Error ? error : undefined,
      )
    }
  }

  async listDirectory(path: string): Promise<FileSystemEntry[]> {
    const dirHandle = await this.getDirectoryHandle(path)
    const entries: FileSystemEntry[] = []

    for await (const [name, handle] of dirHandle.entries()) {
      entries.push({
        name,
        kind: handle.kind,
        path: path ? `${path}/${name}` : name,
      })
    }

    return entries
  }

  async directoryExists(path: string): Promise<boolean> {
    try {
      await this.getDirectoryHandle(path)
      return true
    } catch (error) {
      if (error instanceof FileSystemError && error.code === ErrorCode.DIRECTORY_NOT_FOUND) {
        return false
      }
      throw error
    }
  }

  // ==================== 批量操作实现 ====================

  async readFiles(paths: string[]): Promise<Map<string, string>> {
    const results = new Map<string, string>()

    await Promise.all(
      paths.map(async (path) => {
        try {
          const content = await this.readFile(path)
          results.set(path, content)
        } catch (error) {
          // 批量操作中的单个错误不应中断整个操作
          console.error(`读取文件失败: ${path}`, error)
        }
      }),
    )

    return results
  }

  async writeFiles(files: Map<string, string>): Promise<void> {
    await Promise.all(
      Array.from(files.entries()).map(async ([path, content]) => {
        await this.writeFile(path, content)
      }),
    )
  }

  // ==================== 高级操作实现 ====================

  async copyFile(source: string, dest: string): Promise<void> {
    const content = await this.readFileAsBlob(source)
    await this.writeFile(dest, content)
  }

  async moveFile(source: string, dest: string): Promise<void> {
    await this.copyFile(source, dest)
    await this.deleteFile(source)
  }

  // ==================== 权限管理辅助方法 ====================

  /**
   * 验证句柄权限
   */
  private async verifyPermission(handle: FileSystemDirectoryHandle): Promise<boolean> {
    try {
      // 尝试查询权限
      if (typeof handle.queryPermission === 'function') {
        const permission = await handle.queryPermission({ mode: 'readwrite' })
        if (permission === 'granted') {
          return true
        }

        // 尝试请求权限
        if (typeof handle.requestPermission === 'function') {
          const requested = await handle.requestPermission({ mode: 'readwrite' })
          return requested === 'granted'
        }
      }

      // 降级方案：尝试访问来测试权限
      const entries = handle.entries()
      await entries.next()
      return true
    } catch {
      return false
    }
  }

  /**
   * 弹窗让用户选择工作空间
   */
  private async promptUserToSelectWorkspace(): Promise<boolean> {
    try {
      const directoryHandle = await window.showDirectoryPicker({
        mode: 'readwrite',
        startIn: 'documents',
      })

      // 验证权限
      const hasPermission = await this.verifyPermission(directoryHandle)
      if (!hasPermission) {
        return false
      }

      // 保存句柄
      this.workspaceHandle = directoryHandle
      await this.persistHandleToDB(directoryHandle)

      return true
    } catch (error) {
      // 用户取消选择
      if (error instanceof Error && error.name === 'AbortError') {
        return false
      }
      throw error
    }
  }

  /**
   * 从 IndexedDB 恢复句柄
   */
  private async restoreHandleFromDB(): Promise<FileSystemDirectoryHandle | null> {
    if (!('indexedDB' in window)) {
      return null
    }

    try {
      const result = await indexedDBService.transaction(this.STORE_NAME, 'readonly', (store) =>
        store.get(this.STORAGE_KEY),
      )
      return result || null
    } catch {
      return null
    }
  }

  /**
   * 持久化句柄到 IndexedDB
   */
  private async persistHandleToDB(handle: FileSystemDirectoryHandle): Promise<void> {
    if (!('indexedDB' in window)) {
      return
    }

    await indexedDBService.transaction(this.STORE_NAME, 'readwrite', (store) =>
      store.put(handle, this.STORAGE_KEY),
    )
  }

  /**
   * 从 IndexedDB 清除句柄
   */
  private async clearHandleFromDB(): Promise<void> {
    if (!('indexedDB' in window)) {
      return
    }

    await indexedDBService.transaction(this.STORE_NAME, 'readwrite', (store) =>
      store.delete(this.STORAGE_KEY),
    )
  }

  // ==================== 文件系统辅助方法 ====================

  private async ensureWorkspaceHandle(): Promise<void> {
    if (!this.workspaceHandle) {
      const result = await this.checkPermission()
      if (!result.hasAccess) {
        throw new FileSystemError('未设置工作目录', ErrorCode.PERMISSION_DENIED)
      }
    }
  }

  private async getFileHandle(
    path: string,
    options?: { create?: boolean },
  ): Promise<FileSystemFileHandle> {
    await this.ensureWorkspaceHandle()
    const pathParts = path.split('/').filter((p) => p)

    if (pathParts.length === 0) {
      throw new FileSystemError('无效的文件路径', ErrorCode.INVALID_PATH, path)
    }

    let currentHandle: FileSystemDirectoryHandle = this.workspaceHandle!

    // 遍历路径，获取目录句柄
    for (let i = 0; i < pathParts.length - 1; i++) {
      try {
        currentHandle = await currentHandle.getDirectoryHandle(pathParts[i], options)
      } catch (error) {
        throw new FileSystemError(
          `目录不存在: ${pathParts.slice(0, i + 1).join('/')}`,
          ErrorCode.DIRECTORY_NOT_FOUND,
          path,
          error instanceof Error ? error : undefined,
        )
      }
    }

    // 获取文件句柄
    const fileName = pathParts[pathParts.length - 1]
    try {
      return await currentHandle.getFileHandle(fileName, options)
    } catch (error) {
      throw new FileSystemError(
        `文件不存在: ${fileName}`,
        ErrorCode.FILE_NOT_FOUND,
        path,
        error instanceof Error ? error : undefined,
      )
    }
  }

  private async getDirectoryHandle(
    path: string,
    options?: { create?: boolean },
  ): Promise<FileSystemDirectoryHandle> {
    await this.ensureWorkspaceHandle()

    // 空路径返回根目录
    if (!path || path === '.' || path === '/') {
      return this.workspaceHandle!
    }

    const pathParts = path.split('/').filter((p) => p)
    let currentHandle: FileSystemDirectoryHandle = this.workspaceHandle!

    // 遍历路径
    for (let i = 0; i < pathParts.length; i++) {
      try {
        currentHandle = await currentHandle.getDirectoryHandle(pathParts[i], options)
      } catch (error) {
        throw new FileSystemError(
          `目录不存在: ${pathParts.slice(0, i + 1).join('/')}`,
          ErrorCode.DIRECTORY_NOT_FOUND,
          path,
          error instanceof Error ? error : undefined,
        )
      }
    }

    return currentHandle
  }
}
