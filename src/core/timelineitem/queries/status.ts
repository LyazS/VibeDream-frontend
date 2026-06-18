// ==================== 状态查询函数 ====================
/**
 * 状态查询与状态展示读取
 */

import type { MediaType } from '@/core/mediaitem'
import type { UnifiedTimelineItemData } from '@/core/timelineitem/model/timelineItem'
import { useUnifiedStore } from '@/core/unifiedStore'
import { TimelineStatusDisplayUtils } from '@/core/timelineitem/ui/statusDisplay'

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

  return { hasProgress: true, percent: progressInfo.percent, text }
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
