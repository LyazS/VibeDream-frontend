// ==================== 类型守卫函数 ====================
/**
 * 媒体类型特定的类型守卫
 */

import type { MediaType } from '@/core/mediaitem'
import type { UnifiedTimelineItemData } from '@/core/timelineitem/model/timelineItem'

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

export function hasTimelinePlaceholder(
  item: UnifiedTimelineItemData<MediaType>,
): boolean {
  return item.timelinePlaceholder !== undefined
}

/**
 * 检查是否为具有视觉属性的时间轴项目（video, image）
 */
export function hasVisualProperties(
  item: UnifiedTimelineItemData<MediaType>,
): item is
  | UnifiedTimelineItemData<'video'>
  | UnifiedTimelineItemData<'image'> {
  return isVideoTimelineItem(item) || isImageTimelineItem(item)
}

/**
 * 检查是否为具有音频属性的时间轴项目（video, audio）
 */
export function hasAudioProperties(
  item: UnifiedTimelineItemData<MediaType>,
): item is UnifiedTimelineItemData<'video'> | UnifiedTimelineItemData<'audio'> {
  return isVideoTimelineItem(item) || isAudioTimelineItem(item)
}
