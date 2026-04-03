/**
 * 统一时间轴项目查询工具函数
 * 提供各种查询和计算功能的纯函数
 */

import type { MediaType } from '@/core/mediaitem'
import type {
  UnifiedTimelineItemData,
  TimelineItemStatus,
  GetConfigs,
} from '@/core/timelineitem/type'
import { TimelineStatusDisplayUtils } from '@/core/timelineitem/statusdisplayutils'
import { useUnifiedStore } from '@/core/unifiedStore'
import { supportsClipTransitionOut as itemSupportsClipTransitionOut } from '@/core/timelineitem/transition'

// ==================== 类型守卫函数 ====================

/**
 * 媒体类型特定的类型守卫
 */
export function isVideoTimelineItem(
  item: UnifiedTimelineItemData<MediaType>,
): item is UnifiedTimelineItemData<'video'> {
  return item.mediaType === 'video'
}

export function isImageTimelineItem(
  item: UnifiedTimelineItemData<MediaType>,
): item is UnifiedTimelineItemData<'image'> {
  return item.mediaType === 'image'
}

export function isAudioTimelineItem(
  item: UnifiedTimelineItemData<MediaType>,
): item is UnifiedTimelineItemData<'audio'> {
  return item.mediaType === 'audio'
}

export function isTextTimelineItem(
  item: UnifiedTimelineItemData<MediaType>,
): item is UnifiedTimelineItemData<'text'> {
  return item.mediaType === 'text'
}

/**
 * 检查是否为具有视觉属性的时间轴项目（video, image, text）
 */
export function hasVisualProperties(
  item: UnifiedTimelineItemData<MediaType>,
): item is
  | UnifiedTimelineItemData<'video'>
  | UnifiedTimelineItemData<'image'>
  | UnifiedTimelineItemData<'text'> {
  return isVideoTimelineItem(item) || isImageTimelineItem(item) || isTextTimelineItem(item)
}

/**
 * 检查是否为具有音频属性的时间轴项目（video, audio）
 */
export function hasAudioProperties(
  item: UnifiedTimelineItemData<MediaType>,
): item is UnifiedTimelineItemData<'video'> | UnifiedTimelineItemData<'audio'> {
  return isVideoTimelineItem(item) || isAudioTimelineItem(item)
}

export function supportsClipTransitionOut(
  item: UnifiedTimelineItemData<MediaType>,
): item is UnifiedTimelineItemData<'video'> | UnifiedTimelineItemData<'image'> {
  return itemSupportsClipTransitionOut(item)
}

// ==================== 状态查询函数 ====================

/**
 * 检查是否为就绪状态
 */
export function isReady(data: UnifiedTimelineItemData<MediaType>): boolean {
  return data.timelineStatus === 'ready'
}

/**
 * 检查是否正在加载
 */
export function isLoading(data: UnifiedTimelineItemData<MediaType>): boolean {
  return data.timelineStatus === 'loading'
}

/**
 * 检查是否有错误
 */
export function hasError(data: UnifiedTimelineItemData<MediaType>): boolean {
  return data.timelineStatus === 'error'
}

/**
 * 检查是否可以编辑
 */
export function canEdit(data: UnifiedTimelineItemData<MediaType>): boolean {
  return data.timelineStatus !== 'loading'
}

/**
 * 获取状态显示文本
 */
export function getStatusText(data: UnifiedTimelineItemData<MediaType>): string {
  const unifiedStore = useUnifiedStore()
  const mediaData = unifiedStore.getMediaItem(data.mediaItemId)
  return mediaData ? TimelineStatusDisplayUtils.getStatusText(mediaData) : '未知状态'
}

/**
 * 获取进度信息
 */
export function getProgressInfo(data: UnifiedTimelineItemData<MediaType>): {
  hasProgress: boolean
  percent: number
  text: string
} {
  const unifiedStore = useUnifiedStore()
  const mediaData = unifiedStore.getMediaItem(data.mediaItemId)
  if (!mediaData) {
    return { hasProgress: false, percent: 0, text: '' }
  }

  const progressInfo = TimelineStatusDisplayUtils.getProgressInfo(mediaData)
  if (!progressInfo.hasProgress) {
    return { hasProgress: false, percent: 0, text: '' }
  }

  const text = progressInfo.speed
    ? `${progressInfo.percent}% (${progressInfo.speed})`
    : `${progressInfo.percent}%`

  return {
    hasProgress: true,
    percent: progressInfo.percent,
    text,
  }
}

/**
 * 获取错误信息
 */
export function getErrorInfo(data: UnifiedTimelineItemData<MediaType>): {
  hasError: boolean
  message: string
  recoverable: boolean
} {
  const unifiedStore = useUnifiedStore()
  const mediaData = unifiedStore.getMediaItem(data.mediaItemId)
  if (!mediaData) {
    return { hasError: false, message: '', recoverable: false }
  }

  const errorInfo = TimelineStatusDisplayUtils.getErrorInfo(mediaData)
  return {
    hasError: errorInfo.hasError,
    message: errorInfo.message || '',
    recoverable: errorInfo.recoverable || false,
  }
}

// ==================== 配置访问函数 ====================

/**
 * 获取用于渲染的配置
 * 优先返回 renderConfig（包含动画插值），否则返回 config
 *
 * @param item 时间轴项目
 * @returns 用于渲染的配置对象
 */
export function getRenderConfig<T extends MediaType>(
  item: UnifiedTimelineItemData<T>
): GetConfigs<T> {
  return item.runtime.renderConfig || item.config
}

// ==================== 导出查询工具集合 ====================

export const TimelineItemQueries = {
  // 类型守卫
  isVideoTimelineItem,
  isImageTimelineItem,
  isAudioTimelineItem,
  isTextTimelineItem,
  hasVisualProperties,
  hasAudioProperties,
  supportsClipTransitionOut,

  // 状态查询
  isReady,
  isLoading,
  hasError,
  canEdit,
  getStatusText,
  getProgressInfo,
  getErrorInfo,
  
  // 配置访问
  getRenderConfig,
}
