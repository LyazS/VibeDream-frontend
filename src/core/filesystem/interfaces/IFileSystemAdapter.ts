import type { WorkspaceInfo } from '../core/types'

/**
 * 权限检查结果
 */
export interface PermissionCheckResult {
  /** 是否有访问权限 */
  hasAccess: boolean
  /** 权限是否发生改变（从无到有，或从有到无） */
  accessChanged: boolean
}

/**
 * 文件系统条目
 */
export interface FileSystemEntry {
  name: string
  kind: 'file' | 'directory'
  path: string
}

/**
 * 文件系统适配器接口
 * 所有存储后端都必须实现这个接口
 */
export interface IFileSystemAdapter {
  // ==================== 基础信息 ====================

  /**
   * 检查当前环境是否支持此适配器
   */
  isSupported(): boolean

  /**
   * 获取适配器名称
   */
  getName(): string

  // ==================== 工作空间管理 ====================

  /**
   * 检查并确保工作空间可访问，允许适配器在首次访问时初始化工作空间。
   *
   * @param forcePrompt 对支持目录选择的适配器，强制重新选择；其他适配器仅重新检查访问。
   * @returns 权限检查结果
   */
  checkPermission(forcePrompt?: boolean): Promise<PermissionCheckResult>

  /**
   * 获取工作空间信息
   * @returns 工作空间信息，如果未设置工作空间则返回 null
   */
  getWorkspaceInfo(): Promise<WorkspaceInfo | null>

  // ==================== 文件操作 ====================

  /**
   * 读取文本文件
   */
  readFile(path: string): Promise<string>

  /**
   * 读取二进制文件
   */
  readFileAsBlob(path: string): Promise<Blob>

  /**
   * 写入文件
   */
  writeFile(path: string, content: string | Blob): Promise<void>

  /**
   * 删除文件
   */
  deleteFile(path: string): Promise<void>

  /**
   * 检查文件是否存在
   */
  fileExists(path: string): Promise<boolean>

  // ==================== 目录操作 ====================

  /**
   * 创建目录（递归创建）
   */
  createDirectory(path: string): Promise<void>

  /**
   * 删除目录
   */
  deleteDirectory(path: string, recursive?: boolean): Promise<void>

  /**
   * 列出目录内容
   */
  listDirectory(path: string): Promise<FileSystemEntry[]>

  /**
   * 检查目录是否存在
   */
  directoryExists(path: string): Promise<boolean>

  // ==================== 批量操作 ====================

  /**
   * 批量读取文件
   */
  readFiles(paths: string[]): Promise<Map<string, string>>

  /**
   * 批量写入文件
   */
  writeFiles(files: Map<string, string>): Promise<void>

  // ==================== 高级操作 ====================

  /**
   * 复制文件
   */
  copyFile(source: string, dest: string): Promise<void>

  /**
   * 移动文件
   */
  moveFile(source: string, dest: string): Promise<void>
}
