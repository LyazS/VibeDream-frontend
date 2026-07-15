/**
 * 统一时间轴缩放与坐标映射工具
 *
 * 包含时间轴的：
 * 1. 时长计算功能
 * 2. 坐标转换功能（帧数与像素位置之间）
 * 3. 可见范围计算
 */

import type { UnifiedTimelineItemData } from '@/core/timelineitem/model/timelineItem'
import { secondsToFrames } from '@/core/utils/timeUtils'

// ==================== 时长计算工具 ====================

/**
 * 计算内容结束时间（帧数）
 * @param timelineItems 统一时间轴项目数组
 * @returns 内容结束时间（帧数）
 */
export function calculateContentEndTimeFrames(timelineItems: UnifiedTimelineItemData[]): number {
  if (timelineItems.length === 0) return 0
  return Math.max(
    ...timelineItems.map((item) => {
      return item.timeRange.timelineEndTime
    }),
  )
}

/**
 * 计算总时长（帧数）
 * @param timelineItems 统一时间轴项目数组
 * @param timelineDurationFrames 基础时间轴时长（帧数）
 * @returns 总时长（帧数）
 */
export function calculateTotalDurationFrames(
  timelineItems: UnifiedTimelineItemData[],
  timelineDurationFrames: number,
): number {
  if (timelineItems.length === 0) return timelineDurationFrames
  const maxEndTimeFrames = Math.max(
    ...timelineItems.map((item) => {
      return item.timeRange.timelineEndTime
    }),
  )
  console.log('calculateTotalDurationFrames (Unified):', maxEndTimeFrames, timelineDurationFrames)
  return Math.max(maxEndTimeFrames, timelineDurationFrames)
}

/**
 * 计算最大可见时长（帧数）
 * @param contentEndTimeFrames 内容结束时间（帧数）
 * @param defaultDurationFrames 默认时长（帧数，默认60秒=1800帧）
 * @returns 最大可见时长（帧数）
 */
export function calculateMaxVisibleDurationFrames(
  contentEndTimeFrames: number,
  defaultDurationFrames: number = secondsToFrames(60), // 60秒转换为帧数
): number {
  if (contentEndTimeFrames === 0) {
    return defaultDurationFrames
  }
  // 最大可见范围：视频内容长度的4倍
  return contentEndTimeFrames * 4
}

// ==================== 时间轴坐标转换 ====================

/**
 * 计算可见时间范围（帧数版本）
 * @param timelineWidth 时间轴宽度（像素）
 * @param totalDurationFrames 总时长（帧数）
 * @param zoomLevel 缩放级别
 * @param scrollOffset 滚动偏移量（像素）
 * @param maxVisibleDurationFrames 最大可见时长（帧数）
 * @returns 可见时间范围 { startFrames, endFrames }
 */
export function calculateVisibleFrameRange(
  timelineWidth: number,
  totalDurationFrames: number,
  zoomLevel: number,
  scrollOffset: number,
  maxVisibleDurationFrames?: number,
): { startFrames: number; endFrames: number } {
  const pixelsPerFrame = (timelineWidth * zoomLevel) / totalDurationFrames
  const startFrames = Math.floor(scrollOffset / pixelsPerFrame)
  const calculatedEndFrames = startFrames + Math.ceil(timelineWidth / pixelsPerFrame)
  const endFrames = maxVisibleDurationFrames
    ? Math.min(calculatedEndFrames, maxVisibleDurationFrames)
    : calculatedEndFrames

  return { startFrames, endFrames }
}

/**
 * 将帧数转换为像素位置（考虑缩放和滚动）
 * @param frames 帧数
 * @param timelineWidth 时间轴宽度（像素）
 * @param totalDurationFrames 总时长（帧数）
 * @param zoomLevel 缩放级别
 * @param scrollOffset 滚动偏移量（像素）
 * @returns 像素位置
 */
export function frameToPixel(
  frames: number,
  timelineWidth: number,
  totalDurationFrames: number,
  zoomLevel: number,
  scrollOffset: number,
): number {
  const pixelsPerFrame = (timelineWidth * zoomLevel) / totalDurationFrames
  const pixelPosition = frames * pixelsPerFrame - scrollOffset

  return pixelPosition
}

/**
 * 将像素位置转换为帧数（考虑缩放和滚动）
 * @param pixel 像素位置
 * @param timelineWidth 时间轴宽度（像素）
 * @param totalDurationFrames 总时长（帧数）
 * @param zoomLevel 缩放级别
 * @param scrollOffset 滚动偏移量（像素）
 * @returns 帧数
 */
export function pixelToFrame(
  pixel: number,
  timelineWidth: number,
  totalDurationFrames: number,
  zoomLevel: number,
  scrollOffset: number,
): number {
  const pixelsPerFrame = (timelineWidth * zoomLevel) / totalDurationFrames
  const frames = (pixel + scrollOffset) / pixelsPerFrame

  return frames
}
