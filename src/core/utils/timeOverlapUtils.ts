/**
 * 时间重叠检测工具
 * 统一处理所有时间范围重叠检测的逻辑，避免代码重复
 */
import type { MediaType } from '@/core/mediaitem'
import type { UnifiedTimelineItemData } from '@/core/timelineitem/model/timelineItem'
import type { UnifiedTimeRange } from '@/core/types/timeRange'
import type { OverlapTimeRange, OverlapResult, ConflictInfo } from '@/core/types'

// ==================== 核心重叠检测函数 ====================

/**
 * 检测两个时间范围是否重叠
 * @param range1 时间范围1
 * @param range2 时间范围2
 * @returns 重叠检测结果
 */
export function detectTimeRangeOverlap(
  range1: OverlapTimeRange,
  range2: OverlapTimeRange,
): OverlapResult {
  const overlapStart = Math.max(range1.start, range2.start)
  const overlapEnd = Math.min(range1.end, range2.end)
  const hasOverlap = overlapStart < overlapEnd

  return {
    hasOverlap,
    overlapStart,
    overlapEnd,
    overlapDuration: hasOverlap ? overlapEnd - overlapStart : 0,
  }
}

/**
 * 简单的重叠检测 - 只返回布尔值
 * @param range1 时间范围1
 * @param range2 时间范围2
 * @returns 是否重叠
 */
export function isTimeRangeOverlapping(
  range1: OverlapTimeRange,
  range2: OverlapTimeRange,
): boolean {
  return !(range1.end <= range2.start || range2.end <= range1.start)
}

/**
 * 计算重叠时长
 * @param range1 时间范围1
 * @param range2 时间范围2
 * @returns 重叠时长（帧数），无重叠返回0
 */
export function calculateOverlapDuration(
  range1: OverlapTimeRange,
  range2: OverlapTimeRange,
): number {
  const overlapStart = Math.max(range1.start, range2.start)
  const overlapEnd = Math.min(range1.end, range2.end)
  return Math.max(0, overlapEnd - overlapStart)
}

// ==================== TimelineItem 专用函数 ====================

/**
 * 从TimelineItem提取时间范围
 * @param item 时间轴项目
 * @returns 时间范围
 */
export function extractTimeRange(item: UnifiedTimelineItemData): OverlapTimeRange {
  return {
    start: item.timeRange.timelineStartTime,
    end: item.timeRange.timelineEndTime,
  }
}

/**
 * 检测两个TimelineItem是否重叠
 * @param item1 时间轴项目1
 * @param item2 时间轴项目2
 * @returns 是否重叠
 */
export function isTimelineItemsOverlapping(
  item1: UnifiedTimelineItemData,
  item2: UnifiedTimelineItemData,
): boolean {
  const range1 = extractTimeRange(item1)
  const range2 = extractTimeRange(item2)
  return isTimeRangeOverlapping(range1, range2)
}

// ==================== 轨道级别的重叠检测 ====================

// ==================== 批量重叠检测 ====================

/**
 * 统计轨道组中的重叠项目数量
 * @param timelineItems 所有时间轴项目
 * @returns 重叠项目的数量
 */
export function countOverlappingItems(timelineItems: UnifiedTimelineItemData[]): number {
  let count = 0
  const tracks = new Map<string, UnifiedTimelineItemData[]>()

  // 按轨道分组
  timelineItems.forEach((item) => {
    if (!item.trackId) return // 跳过没有轨道ID的项目

    if (!tracks.has(item.trackId)) {
      tracks.set(item.trackId, [])
    }
    tracks.get(item.trackId)!.push(item)
  })

  // 检查每个轨道内的重叠
  tracks.forEach((trackItems) => {
    for (let i = 0; i < trackItems.length; i++) {
      for (let j = i + 1; j < trackItems.length; j++) {
        if (isTimelineItemsOverlapping(trackItems[i], trackItems[j])) {
          count++
        }
      }
    }
  })

  return count
}
