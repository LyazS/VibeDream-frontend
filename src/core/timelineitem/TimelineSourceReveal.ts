import type { UnifiedTimelineItemData } from './model/timelineItem'

/**
 * 文本片段和任务占位片段没有可反查的素材库源媒体。
 */
export function canRevealTimelineSource(
  timelineItem: Pick<UnifiedTimelineItemData, 'isPlaceholder' | 'mediaType' | 'mediaItemId'>,
): boolean {
  return (
    !timelineItem.isPlaceholder &&
    timelineItem.mediaType !== 'text' &&
    Boolean(timelineItem.mediaItemId)
  )
}
