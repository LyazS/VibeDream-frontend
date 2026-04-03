/**
 * 时间轴项目拖拽源处理器
 */

import type {
  DragSourceHandler,
  DragSourceType,
  TimelineItemDragParams,
  TimelineItemDragData,
  DragSourceParams,
  UnifiedDragData,
} from '@/core/types/drag'
import { DragSourceType as SourceType } from '@/core/types/drag'
import type { UnifiedTimelineModule } from '@/core/modules/UnifiedTimelineModule'
import type { UnifiedSelectionModule } from '@/core/modules/UnifiedSelectionModule'

export class TimelineItemSourceHandler implements DragSourceHandler {
  readonly sourceType: DragSourceType = SourceType.TIMELINE_ITEM

  constructor(
    private timelineModule: UnifiedTimelineModule,
    private selectionModule: UnifiedSelectionModule,
  ) {}

  createDragData(
    element: HTMLElement,
    event: DragEvent,
    params: DragSourceParams,
  ): UnifiedDragData {
    const timelineParams = params as TimelineItemDragParams

    const item = this.timelineModule.getTimelineItem(timelineParams.timelineItemId)

    if (!item) {
      throw new Error(`Timeline item not found: ${timelineParams.timelineItemId}`)
    }

    if (!item.trackId) {
      throw new Error(`Timeline item has no trackId: ${timelineParams.timelineItemId}`)
    }

    // 计算拖拽偏移量（仍然需要 element）
    const rect = element.getBoundingClientRect()
    const dragOffset = {
      x: event.clientX - rect.left,
      y: event.clientY - rect.top,
    }

    const dragData: TimelineItemDragData = {
      sourceType: SourceType.TIMELINE_ITEM,
      timestamp: Date.now(),
      itemId: timelineParams.timelineItemId,
      trackId: item.trackId,
      startTime: item.timeRange.timelineStartTime,
      selectedItems: [...this.selectionModule.selectedClipTimelineItemIds.value],
      dragOffset,
    }

    console.log(`🎬 [TimelineItemSourceHandler] 创建拖拽数据:`, dragData)

    return dragData
  }
}
