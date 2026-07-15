/**
 * 时间轴吸附功能 Composable
 *
 * 负责处理时间轴的吸附计算逻辑，包括：
 * - 头部吸附：片段起始位置吸附到目标点
 * - 尾部吸附：片段结束位置吸附到目标点
 * - 吸附目标收集：播放头、片段边界、关键帧等
 * - 吸附结果计算：选择最优吸附位置
 */

import { ref, type Ref } from 'vue'
import { useUnifiedStore } from '@/core/unifiedStore'
import type { SnapPoint } from '@/types/snap'

/**
 * 吸附位置输入参数
 */
export interface SnapPositionInput {
  mouseX: number // 鼠标相对于时间轴内容区域的X坐标
  timelineWidth: number // 时间轴宽度
  excludeClipIds?: string[] // 排除的片段ID（拖拽自身时使用）
  clipDuration?: number // 片段时长（用于尾部吸附）
}

/**
 * 吸附位置结果
 */
export interface SnapPositionResult {
  frame: number // 最终帧位置（已应用吸附）
  snapped: boolean // 是否发生了吸附
  snapPoint?: SnapPoint // 吸附点信息
  distance?: number // 吸附距离（帧数）
  snappedPart?: 'start' | 'end' // 吸附部位（头部还是尾部）
}

/**
 * 吸附结果状态（用于显示吸附指示器）
 */
export interface SnapResultState {
  snapped: boolean
  frame: number
  snapPoint?: SnapPoint
  distance?: number
}

export function useTimelineSnap() {
  const unifiedStore = useUnifiedStore()

  // 当前吸附结果状态（用于驱动吸附指示器）
  const currentSnapResult: Ref<SnapResultState | null> = ref(null)

  /**
   * 计算吸附位置
   * 这是一个轻量级的吸附实现，专为 CleanTimeline 优化
   * 支持头部和尾部吸附
   *
   * @param input 吸附计算输入参数
   * @returns 吸附结果，包含最终帧位置和吸附信息
   */
  function calculateSnapPosition(input: SnapPositionInput): SnapPositionResult {
    // 1. 计算原始帧位置（头部位置）
    const originalStartFrame = unifiedStore.pixelToFrame(input.mouseX, input.timelineWidth)

    // 2. 检查是否启用吸附
    if (!unifiedStore.snapConfig.enabled) {
      return { frame: originalStartFrame, snapped: false }
    }

    // 3. 收集吸附目标点
    const snapTargets = unifiedStore.collectSnapTargets({
      excludeClipIds: input.excludeClipIds || [],
      includeClipBoundaries: unifiedStore.snapConfig.clipBoundaries,
      includePlayhead: unifiedStore.snapConfig.playhead,
      includeTimelineStart: unifiedStore.snapConfig.timelineStart,
      includeKeyframes: unifiedStore.snapConfig.keyframes,
    })

    // 获取像素阈值并转换为帧数阈值
    const pixelThreshold = unifiedStore.snapConfig.threshold
    const pixelsPerFrame =
      (input.timelineWidth * unifiedStore.zoomLevel) / unifiedStore.totalDurationFrames
    const frameThreshold = pixelThreshold / pixelsPerFrame

    // 4. 计算头部吸附
    let startSnapPoint: SnapPoint | null = null
    let startDistance = Infinity

    for (const target of snapTargets) {
      const distance = Math.abs(originalStartFrame - target.frame)
      if (distance < startDistance && distance <= frameThreshold) {
        startDistance = distance
        startSnapPoint = target
      }
    }

    // 5. 如果有片段时长，计算尾部吸附
    let endSnapPoint: SnapPoint | null = null
    let endDistance = Infinity

    if (input.clipDuration !== undefined && input.clipDuration > 0) {
      const originalEndFrame = originalStartFrame + input.clipDuration

      for (const target of snapTargets) {
        const distance = Math.abs(originalEndFrame - target.frame)
        if (distance < endDistance && distance <= frameThreshold) {
          endDistance = distance
          endSnapPoint = target
        }
      }
    }

    // 6. 选择更好的吸附结果（距离更近的）
    if (startSnapPoint && endSnapPoint) {
      // 两个位置都有吸附，选择距离更近的
      if (startDistance <= endDistance) {
        return {
          frame: startSnapPoint.frame,
          snapped: true,
          snapPoint: startSnapPoint,
          distance: startDistance,
          snappedPart: 'start',
        }
      } else {
        // 尾部吸附，需要调整开始位置
        return {
          frame: endSnapPoint.frame - input.clipDuration!,
          snapped: true,
          snapPoint: endSnapPoint,
          distance: endDistance,
          snappedPart: 'end',
        }
      }
    } else if (startSnapPoint) {
      // 只有头部吸附
      return {
        frame: startSnapPoint.frame,
        snapped: true,
        snapPoint: startSnapPoint,
        distance: startDistance,
        snappedPart: 'start',
      }
    } else if (endSnapPoint) {
      // 只有尾部吸附
      return {
        frame: endSnapPoint.frame - input.clipDuration!,
        snapped: true,
        snapPoint: endSnapPoint,
        distance: endDistance,
        snappedPart: 'end',
      }
    }

    // 7. 没有吸附
    return { frame: originalStartFrame, snapped: false }
  }

  /**
   * 更新吸附指示器状态
   *
   * @param snapResult 吸附计算结果
   * @param clipDuration 片段时长（可选，用于显示尾部吸附位置）
   */
  function updateSnapIndicator(snapResult: SnapPositionResult, clipDuration?: number) {
    if (snapResult.snapped) {
      currentSnapResult.value = {
        snapped: true,
        // 如果是尾部吸附，显示尾部位置；否则显示头部位置
        frame:
          snapResult.snappedPart === 'end'
            ? snapResult.frame + (clipDuration || 0)
            : snapResult.frame,
        snapPoint: snapResult.snapPoint,
        distance: snapResult.distance,
      }
    } else {
      currentSnapResult.value = null
    }
  }

  /**
   * 清除吸附指示器
   */
  function clearSnapIndicator() {
    currentSnapResult.value = null
  }

  /**
   * 计算鼠标相对于时间轴内容区域的X坐标
   *
   * @param event 鼠标事件
   * @param timelineBody 时间轴主体元素
   * @param trackControlWidth 轨道控制区域宽度
   * @returns 相对于时间轴内容区域的X坐标
   */
  function calculateMouseXInTimeline(
    event: MouseEvent | DragEvent,
    timelineBody: HTMLElement,
    trackControlWidth: number,
  ): number {
    const rect = timelineBody.getBoundingClientRect()
    // 减去轨道控制区域的宽度
    return event.clientX - rect.left - trackControlWidth
  }

  return {
    // 状态
    currentSnapResult,

    // 方法
    calculateSnapPosition,
    updateSnapIndicator,
    clearSnapIndicator,
    calculateMouseXInTimeline,
  }
}
