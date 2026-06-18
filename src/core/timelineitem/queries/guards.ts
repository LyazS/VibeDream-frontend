// ==================== 类型守卫函数 ====================
/**
 * 媒体类型特定的类型守卫
 */

import type { MediaType } from '@/core/mediaitem'
import type { UnifiedTimelineItemData } from '@/core/timelineitem/model/timelineItem'
import { supportsClipTransitionOut as itemSupportsClipTransitionOut } from '@/core/timelineitem/features/transition'
import { supportsClipFilter as itemSupportsClipFilter } from '@/core/timelineitem/features/filter'

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

export function supportsClipFilter(
  item: UnifiedTimelineItemData<MediaType>,
): item is UnifiedTimelineItemData<'video'> | UnifiedTimelineItemData<'image'> {
  return itemSupportsClipFilter(item)
}
