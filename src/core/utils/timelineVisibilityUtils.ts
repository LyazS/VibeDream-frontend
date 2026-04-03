/**
 * 时间轴可见性工具函数
 */

import type { UnifiedTimelineItemData } from '@/core/timelineitem/type'
import type { MediaType } from '@/core/mediaitem/types'
import { TimelineItemQueries } from '@/core/timelineitem/queries'

/**
 * 获取当前播放时间点的所有可见时间轴项
 *
 * 过滤条件：
 * 1. 时间轴项目必须在当前播放时间范围内
 * 2. 轨道必须可见
 * 3. 项目必须有视觉属性（video, image, text）
 * 4. 项目必须就绪
 *
 * @param timelineItems 所有时间轴项目
 * @param currentFrame 当前播放帧
 * @param getTrack 获取轨道的函数
 * @returns 可见的时间轴项数组
 */
export function getVisibleTimelineItems(
  timelineItems: UnifiedTimelineItemData<MediaType>[],
  currentFrame: number,
  getTrack: (trackId: string) => { isVisible: boolean } | undefined,
): UnifiedTimelineItemData<MediaType>[] {
  return timelineItems.filter((item) => {
    // 1. 检查是否在当前播放时间范围内
    if (
      currentFrame < item.timeRange.timelineStartTime ||
      currentFrame >= item.timeRange.timelineEndTime
    ) {
      return false
    }

    // 2. 检查轨道是否可见
    const track = item.trackId ? getTrack(item.trackId) : null
    if (track && !track.isVisible) return false

    // 3. 检查是否有视觉属性
    if (!TimelineItemQueries.hasVisualProperties(item)) {
      return false
    }

    // 4. 检查是否就绪
    if (!TimelineItemQueries.isReady(item)) {
      return false
    }

    return true
  })
}

/**
 * 按轨道索引对时间轴项排序（从上到下）
 * 返回的数组中，索引小的在前面，索引大的在后面
 *
 * @param items 时间轴项数组
 * @param trackIndexMap 轨道ID到索引的映射
 * @returns 排序后的时间轴项数组
 */
export function sortTimelineItemsByTrackIndex<T extends UnifiedTimelineItemData<MediaType>>(
  items: T[],
  trackIndexMap: Map<string, number>,
): T[] {
  return [...items].sort((a, b) => {
    const getTrackIndex = (trackId: string | undefined): number => {
      if (!trackId) return -Infinity
      return trackIndexMap.get(trackId) ?? -Infinity
    }

    return getTrackIndex(a.trackId) - getTrackIndex(b.trackId)
  })
}
