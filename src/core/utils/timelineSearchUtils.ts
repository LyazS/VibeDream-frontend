/**
 * 统一时间轴搜索工具函数
 * 适配自旧架构的 timelineSearchUtils，支持统一类型系统
 */

import type { UnifiedTimelineItemData } from '@/core/timelineitem/model/timelineItem'
import type { MediaTypeOrUnknown, UnifiedMediaItemData } from '@/core/mediaitem'

// ==================== 查找工具 ====================

/**
 * 根据时间查找对应的时间轴项目（帧数版本）
 * @param frames 时间（帧数）
 * @param timelineItems 时间轴项目数组
 * @returns 找到的时间轴项目或null
 */
export function getTimelineItemAtFrames(
  frames: number,
  timelineItems: UnifiedTimelineItemData[],
): UnifiedTimelineItemData | null {
  return (
    timelineItems.find((item) => {
      const timeRange = item.timeRange
      const startFrames = timeRange.timelineStartTime
      const endFrames = timeRange.timelineEndTime
      return frames >= startFrames && frames < endFrames
    }) || null
  )
}

/**
 * 根据轨道ID查找时间轴项目
 * @param trackId 轨道ID
 * @param timelineItems 时间轴项目数组
 * @returns 该轨道的所有项目
 */
export function getTimelineItemsByTrack(
  trackId: string,
  timelineItems: UnifiedTimelineItemData[],
): UnifiedTimelineItemData[] {
  return timelineItems.filter((item) => item.trackId === trackId)
}

/**
 * 查找孤立的时间轴项目（没有对应媒体项目）
 * @param timelineItems 时间轴项目数组
 * @param mediaItems 媒体项目数组
 * @returns 孤立的时间轴项目
 */
export function findOrphanedTimelineItems(
  timelineItems: UnifiedTimelineItemData[],
  mediaItems: UnifiedMediaItemData[],
): UnifiedTimelineItemData[] {
  return timelineItems.filter(
    (timelineItem) => !mediaItems.find((mediaItem) => mediaItem.id === timelineItem.mediaItemId),
  )
}



/**
 * 根据时间查找所有重叠的时间轴项目（帧数版本）
 * @param frames 时间（帧数）
 * @param timelineItems 时间轴项目数组
 * @returns 重叠的时间轴项目数组
 */
export function getTimelineItemsAtFrames(
  frames: number,
  timelineItems: UnifiedTimelineItemData[],
): UnifiedTimelineItemData[] {
  return timelineItems.filter((item) => {
    const timeRange = item.timeRange
    const startFrames = timeRange.timelineStartTime
    const endFrames = timeRange.timelineEndTime
    return frames >= startFrames && frames < endFrames
  })
}

/**
 * 根据轨道和时间查找时间轴项目（帧数版本）
 * @param trackId 轨道ID
 * @param frames 时间（帧数）
 * @param timelineItems 时间轴项目数组
 * @returns 找到的时间轴项目或null
 */
export function getTimelineItemAtTrackAndFrames(
  trackId: string,
  frames: number,
  timelineItems: UnifiedTimelineItemData[],
): UnifiedTimelineItemData | null {
  return (
    timelineItems.find((item) => {
      if (item.trackId !== trackId) return false
      const timeRange = item.timeRange
      const startFrames = timeRange.timelineStartTime
      const endFrames = timeRange.timelineEndTime
      return frames >= startFrames && frames < endFrames
    }) || null
  )
}

/**
 * 检测播放头是否在TimelineItem的时间范围内
 * @param item 时间轴项目
 * @param currentFrame 当前播放帧数
 * @returns 是否在时间范围内
 */
export function isPlayheadInTimelineItem(
  item: UnifiedTimelineItemData,
  currentFrame: number,
): boolean {
  // 允许播放头在clip结束位置进行关键帧操作，这样用户可以在第4帧位置操作3帧的视频
  // 这主要是为了配合播放头吸附功能，用户习惯在clip结束后的位置进行操作
  return (
    currentFrame >= item.timeRange.timelineStartTime &&
    currentFrame <= item.timeRange.timelineEndTime
  )
}

/**
 * 根据媒体类型过滤时间轴项目
 * @param mediaType 媒体类型
 * @param timelineItems 时间轴项目数组
 * @returns 指定类型的时间轴项目数组
 */
export function getTimelineItemsByMediaType(
  mediaType: MediaTypeOrUnknown,
  timelineItems: UnifiedTimelineItemData[],
): UnifiedTimelineItemData[] {
  return timelineItems.filter((item) => item.mediaType === mediaType)
}

/**
 * 根据状态过滤时间轴项目
 * @param status 时间轴项目状态
 * @param timelineItems 时间轴项目数组
 * @returns 指定状态的时间轴项目数组
 */
export function getTimelineItemsByStatus(
  status: 'ready' | 'loading' | 'error',
  timelineItems: UnifiedTimelineItemData[],
): UnifiedTimelineItemData[] {
  return timelineItems.filter((item) => item.timelineStatus === status)
}

/**
 * 获取时间轴项目的时长（帧数）
 * @param item 时间轴项目
 * @returns 时长（帧数）
 */
export function getTimelineItemDuration(item: UnifiedTimelineItemData): number {
  return item.timeRange.timelineEndTime - item.timeRange.timelineStartTime
}

/**
 * 按时间位置排序时间轴项目
 * @param timelineItems 时间轴项目数组
 * @param ascending 是否升序排列（默认true）
 * @returns 排序后的时间轴项目数组
 */
export function sortTimelineItemsByTime(
  timelineItems: UnifiedTimelineItemData[],
  ascending: boolean = true,
): UnifiedTimelineItemData[] {
  return [...timelineItems].sort((a, b) => {
    const diff = a.timeRange.timelineStartTime - b.timeRange.timelineStartTime
    return ascending ? diff : -diff
  })
}

/**
 * 查找与指定时间范围重叠的时间轴项目
 * @param startTime 开始时间（帧数）
 * @param endTime 结束时间（帧数）
 * @param timelineItems 时间轴项目数组
 * @param excludeItemId 要排除的项目ID（可选）
 * @returns 重叠的时间轴项目数组
 */
export function findOverlappingTimelineItems(
  startTime: number,
  endTime: number,
  timelineItems: UnifiedTimelineItemData[],
  excludeItemId?: string,
): UnifiedTimelineItemData[] {
  return timelineItems.filter((item) => {
    if (excludeItemId && item.id === excludeItemId) {
      return false
    }

    const itemStart = item.timeRange.timelineStartTime
    const itemEnd = item.timeRange.timelineEndTime

    // 检查是否有重叠：两个时间范围重叠的条件是开始时间小于对方的结束时间，且结束时间大于对方的开始时间
    return startTime < itemEnd && endTime > itemStart
  })
}

/**
 * 查找指定轨道上与时间范围重叠的时间轴项目
 * @param trackId 轨道ID
 * @param startTime 开始时间（帧数）
 * @param endTime 结束时间（帧数）
 * @param timelineItems 时间轴项目数组
 * @param excludeItemId 要排除的项目ID（可选）
 * @returns 重叠的时间轴项目数组
 */
export function findOverlappingTimelineItemsOnTrack(
  trackId: string,
  startTime: number,
  endTime: number,
  timelineItems: UnifiedTimelineItemData[],
  excludeItemId?: string,
): UnifiedTimelineItemData[] {
  const trackItems = getTimelineItemsByTrack(trackId, timelineItems)
  return findOverlappingTimelineItems(startTime, endTime, trackItems, excludeItemId)
}
