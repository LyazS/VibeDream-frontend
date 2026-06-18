/**
 * 统一时间范围工具函数
 * 基于新架构的统一类型系统，适用于UnifiedTimelineItemData
 */

import type { UnifiedTimelineItemData } from '@/core/timelineitem/model/timelineItem'
import type { UnifiedTimeRange } from '@/core/types/timeRange'
import { TimelineItemQueries } from '@/core/timelineitem/queries'

// ==================== 时间范围计算工具 ====================

/**
 * 计算时间轴项目的持续时长（帧数）
 * @param timelineItem UnifiedTimelineItemData实例
 * @returns 持续时长（帧数）
 */
export function calculateDuration(timelineItem: UnifiedTimelineItemData): number {
  return timelineItem.timeRange.timelineEndTime - timelineItem.timeRange.timelineStartTime
}
