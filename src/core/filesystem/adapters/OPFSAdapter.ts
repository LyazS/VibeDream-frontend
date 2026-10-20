import type { FileSystemEntry, IFileSystemAdapter, PermissionCheckResult } from '../interfaces'
import type { WorkspaceInfo } from '../core/types'
import { ErrorCode } from '../errors/ErrorCodes'
import { FileSystemError } from '../errors/FileSystemError'

export interface OPFSAdapterOptions {
  workspaceId: string
}

/** 基于浏览器私有文件系统的工作空间。实例创建后固定命名空间，不申请目录授权。 */
export class OPFSAdapter implements IFileSystemAdapter {
  private readonly workspaceId: string
  private rootPromise?: Promise<FileSystemDirectoryHandle>
  private mutations: Promise<void> = Promise.resolve()
  private hasAccess = false

  constructor({ workspaceId }: OPFSAdapterOptions) {
    if (typeof workspaceId !== 'string' || !/^[a-zA-Z0-9_-]{1,80}$/.test(workspaceId)) {
      throw new FileSystemError('无效的 OPFS 工作空间 ID', ErrorCode.INVALID_PATH, workspaceId)
    }
    this.workspaceId = workspaceId
  }

  getName(): string {
    return 'OPFS'
  }

  isSupported(): boolean {
    return (
      globalThis.isSecureContext === true &&
      typeof globalThis.navigator?.storage?.getDirectory === 'function' &&
      typeof globalThis.FileSystemFileHandle?.prototype.createWritable === 'function'
    )
  }

  async checkPermission(_forcePrompt = false): Promise<PermissionCheckResult> {
    try {
      // 每次检查实际访问缓存句柄；目录被外部删除后不得静默重建旧工程。
      await this.read('', async () => {
        const root = await this.getRoot()
        await root.entries().next()
      })
      const accessChanged = !this.hasAccess
      this.hasAccess = true
      return { hasAccess: true, accessChanged }
    } catch (error) {
      this.hasAccess = false
      throw error
    }
  }

  async getWorkspaceInfo(): Promise<WorkspaceInfo> {
    await this.checkPermission()
    return { name: this.workspaceId, canChangeWorkspace: false }
  }

  readFile(path: string): Promise<string> {
    return this.read(path, async () => (await this.getFile(path)).text())
  }

  readFileAsBlob(path: string): Promise<Blob> {
    return this.read(path, () => this.getFile(path))
  }

  writeFile(path: string, content: string | Blob): Promise<void> {
    return this.mutate(path, () => this.write(path, content))
  }

  deleteFile(path: string): Promise<void> {
    return this.mutate(path, () => this.removeFile(path))
  }

  fileExists(path: string): Promise<boolean> {
    return this.read(path, async () => {
      try {
        await this.getFileHandle(path)
        return true
      } catch (error) {
        if (error instanceof FileSystemError && error.code === ErrorCode.FILE_NOT_FOUND)
          return false
        throw error
      }
    })
  }

  createDirectory(path: string): Promise<void> {
    return this.mutate(path, async () => {
      await this.getDirectory(this.parts(path, true), true)
    })
  }

  deleteDirectory(path: string, recursive = false): Promise<void> {
    return this.mutate(path, async () => {
      const parts = this.parts(path)
      // removeEntry 本身不区分文件和目录，删除前必须检查目标类型。
      await this.getDirectory(parts)
      const parent = await this.getDirectory(parts.slice(0, -1))
      try {
        await parent.removeEntry(parts[parts.length - 1]!, { recursive })
      } catch (error) {
        if (error instanceof Error && error.name === 'InvalidModificationError') {
          throw new FileSystemError('目录不为空', ErrorCode.DIRECTORY_NOT_EMPTY, path, error)
        }
        throw this.failure(error, path, ErrorCode.DIRECTORY_NOT_FOUND)
      }
    })
  }

  listDirectory(path: string): Promise<FileSystemEntry[]> {
    return this.read(path, async () => {
      const parts = this.parts(path, true)
      const directory = await this.getDirectory(parts)
      const prefix = parts.join('/')
      const entries: FileSystemEntry[] = []
      for await (const [name, handle] of directory.entries()) {
        entries.push({ name, kind: handle.kind, path: prefix ? `${prefix}/${name}` : name })
      }
      return entries
    })
  }

  directoryExists(path: string): Promise<boolean> {
    return this.read(path, async () => {
      try {
        await this.getDirectory(this.parts(path, true))
        return true
      } catch (error) {
        if (error instanceof FileSystemError && error.code === ErrorCode.DIRECTORY_NOT_FOUND)
          return false
        throw error
      }
    })
  }

  readFiles(paths: string[]): Promise<Map<string, string>> {
    return this.read('', async () => {
      const results = new Map<string, string>()
      await Promise.all(
        paths.map(async (path) => {
          try {
            results.set(path, await (await this.getFile(path)).text())
          } catch (error) {
            console.error('[OPFS] 读取文件失败', path, this.failure(error, path))
          }
        }),
      )
      return results
    })
  }

  writeFiles(files: Map<string, string>): Promise<void> {
    return this.mutate('', async () => {
      let firstError: FileSystemError | undefined
      for (const [path, content] of files) {
        try {
          await this.write(path, content)
        } catch (error) {
          firstError ??= this.failure(error, path)
        }
      }
      if (firstError) throw firstError
    })
  }

  copyFile(source: string, dest: string): Promise<void> {
    return this.mutate(source, async () => {
      if (this.samePath(source, dest)) return
      await this.write(dest, await this.getFile(source))
    })
  }

  moveFile(source: string, dest: string): Promise<void> {
    return this.mutate(source, async () => {
      if (this.samePath(source, dest)) return
      await this.write(dest, await this.getFile(source))
      await this.removeFile(source)
    })
  }

  /** 修改串行执行，读操作等待调用前已排队的修改；错误不阻塞后续操作。 */
  private mutate<T>(path: string, operation: () => Promise<T>): Promise<T> {
    const pending = this.mutations.then(() => this.run(path, operation))
    this.mutations = pending.then(
      () => undefined,
      () => undefined,
    )
    return pending
  }

  private read<T>(path: string, operation: () => Promise<T>): Promise<T> {
    return this.mutations.then(() => this.run(path, operation))
  }

  private async run<T>(path: string, operation: () => Promise<T>): Promise<T> {
    try {
      return await operation()
    } catch (error) {
      throw this.failure(error, path)
    }
  }

  private getRoot(): Promise<FileSystemDirectoryHandle> {
    if (!this.rootPromise) {
      this.rootPromise = (async () => {
        if (!this.isSupported()) {
          throw new FileSystemError('当前环境不支持 OPFS 工作空间', ErrorCode.NOT_SUPPORTED)
        }
        const root = await navigator.storage.getDirectory()
        const workspaces = await root.getDirectoryHandle('lightcut-workspaces', { create: true })
        return workspaces.getDirectoryHandle(this.workspaceId, { create: true })
      })().catch((error: unknown) => {
        this.rootPromise = undefined
        throw this.failure(error, this.workspaceId)
      })
    }
    return this.rootPromise
  }

  private parts(path: string, allowRoot = false): string[] {
    const parts = path.split('/').filter(Boolean)
    if (allowRoot && (path === '.' || parts.length === 0)) return []
    if (
      parts.length === 0 ||
      /[\\\0]/.test(path) ||
      /^[a-zA-Z][a-zA-Z\d+.-]*:/.test(parts.join('/')) ||
      parts.some((part) => part === '.' || part === '..')
    ) {
      throw new FileSystemError('无效的工作空间相对路径', ErrorCode.INVALID_PATH, path)
    }
    return parts
  }

  private samePath(source: string, dest: string): boolean {
    return this.parts(source).join('/') === this.parts(dest).join('/')
  }

  private async getDirectory(parts: string[], create = false): Promise<FileSystemDirectoryHandle> {
    let directory = await this.getRoot()
    for (const part of parts) {
      try {
        directory = await directory.getDirectoryHandle(part, { create })
      } catch (error) {
        throw this.failure(error, parts.join('/'), ErrorCode.DIRECTORY_NOT_FOUND)
      }
    }
    return directory
  }

  private async getFileHandle(path: string, create = false): Promise<FileSystemFileHandle> {
    const parts = this.parts(path)
    const parent = await this.getDirectory(parts.slice(0, -1), create)
    try {
      return await parent.getFileHandle(parts[parts.length - 1]!, { create })
    } catch (error) {
      throw this.failure(error, path, ErrorCode.FILE_NOT_FOUND)
    }
  }

  private async getFile(path: string): Promise<File> {
    const handle = await this.getFileHandle(path)
    try {
      return await handle.getFile()
    } catch (error) {
      throw this.failure(error, path, ErrorCode.FILE_NOT_FOUND)
    }
  }

  private async write(path: string, content: string | Blob): Promise<void> {
    const handle = await this.getFileHandle(path, true)
    let writable: FileSystemWritableFileStream | undefined
    try {
      writable = await handle.createWritable()
      await writable.write(content)
      await writable.close()
    } catch (error) {
      try {
        await writable?.abort()
      } catch {
        // 关闭失败后流可能已终止，保留最初的写入错误。
      }
      throw this.failure(error, path)
    }
  }

  private async removeFile(path: string): Promise<void> {
    const parts = this.parts(path)
    await this.getFileHandle(path)
    const parent = await this.getDirectory(parts.slice(0, -1))
    try {
      await parent.removeEntry(parts[parts.length - 1]!)
    } catch (error) {
      throw this.failure(error, path, ErrorCode.FILE_NOT_FOUND)
    }
  }

  private failure(error: unknown, path: string, missingCode?: ErrorCode): FileSystemError {
    if (error instanceof FileSystemError) return error
    const cause = error instanceof Error ? error : new Error(String(error))
    let code = ErrorCode.OPERATION_FAILED
    if (cause.name === 'NotFoundError' && missingCode) code = missingCode
    else if (cause.name === 'NotAllowedError' || cause.name === 'SecurityError')
      code = ErrorCode.PERMISSION_DENIED
    return new FileSystemError(`OPFS 操作失败: ${cause.message}`, code, path, cause)
  }
}
