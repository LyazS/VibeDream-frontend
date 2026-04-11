/**
 * 统一拖拽方案类型定义
 * 基于新架构从零开始实现
 */

import type { FileInputConfig, MultiFileData } from '@/core/datasource/providers/ai-generation/types'
import type { AssetKind, EffectType } from '@/core/asset/types'
import type { AnyEffectPackagePayload } from '@/core/effect-package/types'
import type { MediaTypeOrUnknown } from '@/core/mediaitem/types'

// ==================== 拖拽源类型 ====================

/**
 * 拖拽源类型枚举
 */
export enum DragSourceType {
  ASSET = 'asset', // 通用资产
  MEDIA_ITEM = 'media-item', // 素材项目
  FOLDER = 'folder', // 文件夹
  TIMELINE_ITEM = 'timeline-item', // 时间轴项目
}

/**
 * 素材项目拖拽参数
 */
export interface AssetDragParams {
  assetId: string
  selectedAssetIds?: string[]
}

/**
 * 文件夹拖拽参数
 */
export interface FolderDragParams {
  folderId: string
}

/**
 * 时间轴项目拖拽参数
 */
export interface TimelineItemDragParams {
  timelineItemId: string
}

/**
 * 拖拽源参数联合类型
 */
export type DragSourceParams = AssetDragParams | FolderDragParams | TimelineItemDragParams

// ==================== 拖拽目标类型 ====================

/**
 * 拖拽目标类型枚举
 */
export enum DropTargetType {
  FOLDER = 'folder', // 文件夹
  TAB = 'tab', // 垂直标签页
  TIMELINE_TRACK = 'timeline-track', // 时间轴轨道
  AI_GENERATION_PANEL = 'ai-generation-panel', // AI生成面板
  CLIP_FILTER_DROPZONE = 'clip-filter-dropzone', // 片段滤镜专用投放区
}

// ==================== 拖拽数据类型 ====================

/**
 * 统一拖拽数据基础接口
 */
export interface BaseDragData {
  sourceType: DragSourceType
  timestamp: number // 拖拽开始时间戳，用于调试
}

/**
 * 素材项目拖拽数据
 */
export interface AssetDragData extends BaseDragData {
  sourceType: DragSourceType.ASSET | DragSourceType.MEDIA_ITEM
  assetIds: string[]
  assetId: string
  sourceFolderId?: string // 来源文件夹ID
  name: string
  assetKind: AssetKind
  duration?: number
  mediaType?: MediaTypeOrUnknown
  effectType?: EffectType
  templatePayload?: AnyEffectPackagePayload | unknown
  type?: 'media-item' // 兼容旧代码
}

export type MediaItemDragData = AssetDragData

/**
 * 文件夹拖拽数据
 */
export interface FolderDragData extends BaseDragData {
  sourceType: DragSourceType.FOLDER
  folderId: string
  folderName: string
  sourceFolderId?: string // 父文件夹ID
}

/**
 * 时间轴项目拖拽数据
 */
export interface TimelineItemDragData extends BaseDragData {
  sourceType: DragSourceType.TIMELINE_ITEM
  timelineItemId: string
  trackId: string
  startTime: number
  selectedItems: string[]
  dragOffset: { x: number; y: number }
  type?: 'timeline-item' // 兼容旧代码
}

/**
 * 联合类型：所有拖拽数据
 */
export type UnifiedDragData = AssetDragData | FolderDragData | TimelineItemDragData

// ==================== 拖拽目标信息 ====================

/**
 * 拖拽目标位置信息
 */
export interface DropPosition {
  time: number // 帧数
  x: number // 像素位置
  y: number
}

/**
 * 时间轴轨道拖拽目标信息
 */
export interface TimelineTrackDropTargetInfo {
  targetType: DropTargetType.TIMELINE_TRACK
  targetId: string // 轨道ID
  position: DropPosition // 位置信息（必填）
}

/**
 * 文件夹或标签页拖拽目标信息
 */
export interface FolderOrTabDropTargetInfo {
  targetType: DropTargetType.FOLDER | DropTargetType.TAB
  targetId: string // 文件夹ID或标签页ID
  position?: never // 不允许有position
}

/**
 * AI生成面板拖拽目标信息
 */
export interface AIGenerationPanelDropTargetInfo {
  targetType: DropTargetType.AI_GENERATION_PANEL
  fieldConfig: FileInputConfig // 字段配置信息
  targetIndex?: number // 目标槽位索引
  currentFiles?: MultiFileData // 当前已有文件
  position?: never
}

export interface ClipFilterDropTargetInfo {
  targetType: DropTargetType.CLIP_FILTER_DROPZONE
  timelineItemId: string
  position?: never
}

/**
 * 拖拽目标信息联合类型
 */
export type DropTargetInfo =
  | TimelineTrackDropTargetInfo
  | FolderOrTabDropTargetInfo
  | AIGenerationPanelDropTargetInfo
  | ClipFilterDropTargetInfo

// ==================== 拖拽预览数据（保留现有定义） ====================

/**
 * 拖拽预览数据结构
 */
export interface DragPreviewData {
  name: string
  duration: number // 预览时长（帧数）
  startTime: number // 开始时间（帧数）
  trackId: string
  isConflict?: boolean
  isMultiple?: boolean
  count?: number
  height?: number // 预览高度（像素）
  mediaType?: 'video' | 'image' | 'audio' | 'text'
  statusInfo?: {
    isReady: boolean
    isLoading: boolean
    hasError?: boolean
  }
}

// ==================== 拖拽放置结果 ====================

/**
 * 拖拽放置结果
 */
export interface DropResult {
  success: boolean
  data?: any // 可选的返回数据
  error?: string // 错误信息
}

/**
 * 多文件拖拽放置结果
 */
export interface MultiFileDropResult extends DropResult {
  targetIndex?: number // 目标槽位索引
  operation?: 'add' | 'replace' // 操作类型
}

// ==================== 拖拽处理器接口 ====================

/**
 * 拖拽源处理器接口
 * 负责处理 dragstart 事件，创建拖拽数据
 */
export interface DragSourceHandler {
  /**
   * 获取源类型
   */
  readonly sourceType: DragSourceType

  /**
   * 创建拖拽数据
   * @param element 被拖拽的DOM元素（用于计算偏移量等）
   * @param event 拖拽事件
   * @param params 拖拽参数（由调用方从 DOM 或其他来源提取）
   * @returns 拖拽数据对象
   */
  createDragData(element: HTMLElement, event: DragEvent, params: DragSourceParams): UnifiedDragData
}

/**
 * 拖拽目标处理器接口
 * 负责处理 dragover 和 drop 事件
 */
export interface DropTargetHandler {
  /**
   * 获取目标类型
   */
  readonly targetType: DropTargetType

  /**
   * 检查是否接受此拖拽源
   * @param dragData 拖拽数据
   * @returns 是否接受
   */
  canAccept(dragData: UnifiedDragData): boolean

  /**
   * 处理拖拽悬停（dragover）
   * @param event 拖拽事件
   * @param dragData 拖拽数据
   * @param targetInfo 目标信息
   * @returns 是否允许放置
   */
  handleDragOver(event: DragEvent, dragData: UnifiedDragData, targetInfo: DropTargetInfo): boolean

  /**
   * 处理拖拽放置（drop）
   * @param event 拖拽事件
   * @param dragData 拖拽数据
   * @param targetInfo 目标信息
   * @returns 拖拽放置结果
   */
  handleDrop(
    event: DragEvent,
    dragData: UnifiedDragData,
    targetInfo: DropTargetInfo,
  ): Promise<DropResult>
}
