/**
 * 缩略图相关类型定义
 */

import type { UnifiedTimelineItemData } from '@/core/timelineitem/model/timelineItem'
import type { MediaType } from '@/core/mediaitem/types'

/**
 * 缩略图布局项
 */
export interface ThumbnailLayoutItem {
  index: number // 缩略图索引
  framePosition: number // 在clip内的帧位置
  timelineFramePosition: number // 在时间轴上的帧位置
  pixelPosition: number // 像素位置（用于CSS定位）
  thumbnailUrl: string | null // 缩略图URL
}

/**
 * 缩略图配置
 */
export interface ThumbnailConfig {
  width: number // 固定宽度50px
  height: number // 固定高度30px
  preloadRange: number // 预加载范围（像素）
  maxCacheSize: number // 最大缓存数量
  batchSize: number // 批量处理大小
}

/**
 * 默认缩略图配置
 */
export const defaultThumbnailConfig: ThumbnailConfig = {
  width: 50,
  height: 30,
  preloadRange: 200,
  maxCacheSize: 1000,
  batchSize: 10,
}

/**
 * 缩略图生成请求
 */
export interface ThumbnailGenerationRequest {
  timelineItemId: string
  frame: number
  mediaItem: UnifiedTimelineItemData<MediaType>
  priority: ThumbnailPriority
  timestamp: number
}

/**
 * 缩略图优先级
 */
export enum ThumbnailPriority {
  HIGH = 3, // 视口内可见
  MEDIUM = 2, // 预加载范围
  LOW = 1, // 其他
}

/**
 * 缩略图生成结果
 */
export interface ThumbnailGenerationResult {
  timelineItemId: string
  frame: number
  thumbnailUrl: string
  timestamp: number
}

/**
 * 缩略图缓存状态
 */
export interface ThumbnailCacheStatus {
  totalCached: number
  cachedPerItem: Map<string, number>
  pendingGenerations: number
}

/**
 * 缓存的缩略图信息
 */
export interface CachedThumbnail {
  blobUrl: string
  timestamp: number
  timelineItemId: string
  framePosition: number
  clipStartTime: number
  clipEndTime: number
}

/**
 * 批量缩略图请求
 */
export interface ThumbnailBatchRequest {
  /** 时间轴项目ID */
  timelineItemId: string

  /** 缩略图布局数组，包含需要生成的帧索引信息 */
  thumbnailLayout: ThumbnailLayoutItem[]

  /** 请求时间戳 */
  timestamp: number
}
