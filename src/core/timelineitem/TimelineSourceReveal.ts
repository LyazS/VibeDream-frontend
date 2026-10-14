import type { UnifiedTimelineItemData } from './model/timelineItem'

/**
 * 文本片段没有可反查的素材库源媒体。
 */
export function canRevealTimelineSource(
  timelineItem: Pick<UnifiedTimelineItemData, 'mediaType' | 'mediaItemId'>,
): boolean {
  return timelineItem.mediaType !== 'text' && Boolean(timelineItem.mediaItemId)
}
