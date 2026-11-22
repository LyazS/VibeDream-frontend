import type { UnifiedTimelineItemData } from './model/timelineItem'

/**
 */
export function canRevealTimelineSource(
  timelineItem: Pick<UnifiedTimelineItemData, 'mediaType' | 'mediaItemId'>,
): boolean {
  return Boolean(timelineItem.mediaItemId)
}
