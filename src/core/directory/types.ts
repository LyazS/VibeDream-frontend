/**
 * 目录模块类型定义
 * 包含虚拟目录、标签页、显示项、剪贴板等相关接口
 */

import type { FileData } from '@/core/datasource/providers/ai-generation/types'

// ==================== 目录相关类型 ====================

/**
 * 文件夹类型枚举
 * 用于区分不同类型的特殊文件夹
 */
export enum DirectoryType {
  BASE = 'base',
  CHARACTER = 'character',
}

/**
 * 角色信息接口
 */
export interface CharacterInfo {
  remark: string // 角色备注文本
  refVideo: FileData[] // 角色参考视频
  profileMediaItemId?: string // 可选：角色头像对应的 MediaItem ID
  timestamps: { st: number; ed: number } // 时间戳范围（开始时间和结束时间，单位：秒）
}

/**
 * 虚拟目录数据结构
 * 包含子文件夹和资产的完整信息
 */
export interface VirtualDirectory {
  readonly type: DirectoryType // 目录类型，用于区分不同类型的特殊文件夹（默认：'base'）
  // 核心字段
  id: string // 唯一标识符，格式：dir_{nanoid}
  name: string // 目录名称
  parentId: string | null // 父目录ID，null表示根目录
  createdAt: string // 创建时间（ISO 8601）

  // 内容引用
  childDirIds: string[] // 子目录ID列表
  assetIds: string[] // 资产ID列表
}

/**
 * 角色文件夹接口
 * 继承自 VirtualDirectory，type 为 'character'
 */
export interface CharacterDirectory extends VirtualDirectory {
  readonly type: DirectoryType.CHARACTER // 固定为 'character'
  character: CharacterInfo // 角色信息
}

/**
 * 左侧标签页显示项
 * 标签页通过 dirId 指向当前显示的目录（可以是任何层级的目录）
 */
export interface DisplayTab {
  id: string // 标签页唯一ID，格式：tab_{nanoid}
  dirId: string // 当前显示的目录ID（指向 VirtualDirectory.id）
}

/**
 * 右侧内容区显示项
 * 文件夹和资产共用此结构
 * 只保存 ID，通过索引获取完整数据
 */
export interface DisplayItem {
  id: string // 唯一标识（目录ID或资产ID）
  type: 'directory' | 'asset' // 项目类型
}

/**
 * 目录导航 UI 状态
 */
export interface DirectoryNavigationState {
  openTabs: DisplayTab[] // 打开的标签页列表
  activeTabId: string // 当前活动标签页ID（指向 DisplayTab.id）
}

// ==================== 剪贴板相关类型 ====================

/**
 * 剪贴板操作类型
 */
export enum ClipboardOperation {
  CUT = 'cut',
  COPY = 'copy',
}

/**
 * 剪贴板项目（DisplayItem 的类型别名）
 * 剪贴板中的项目与显示项结构完全相同
 */
export type ClipboardItem = DisplayItem

/**
 * 剪贴板状态
 */
export interface ClipboardState {
  operation: ClipboardOperation | null
  items: ClipboardItem[]
  sourceDirId: string | null
  timestamp: number
}

/**
 * 粘贴错误信息
 */
export interface PasteError {
  itemId: string
  error: string
}

/**
 * 粘贴结果
 */
export interface PasteResult {
  success: boolean
  successCount: number
  failedCount: number
  errors: PasteError[]
}

// ==================== 视图和排序类型 ====================

/**
 * 视图模式类型
 */
export type ViewMode = 'large-icon' | 'medium-icon' | 'small-icon' | 'list'

/**
 * 排序字段类型
 */
export type SortBy = 'name' | 'date' | 'type'

/**
 * 排序顺序类型
 */
export type SortOrder = 'asc' | 'desc'

/**
 * 统一目录配置接口
 * 独立于项目配置的目录数据结构
 */
export interface UnifiedDirectoryConfig {
  // 目录数据
  directories: VirtualDirectory[] // 目录列表
  openTabs: DisplayTab[] // 打开的标签页列表
  activeTabId: string // 当前活动标签页ID

  // 视图和排序设置
  viewMode: ViewMode // 视图模式
  sortBy: SortBy // 排序字段
  sortOrder: SortOrder // 排序顺序
}
