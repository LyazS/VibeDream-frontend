import { LayoutConstants } from '@/constants/LayoutConstants'
import { useUnifiedStore } from '@/core/unifiedStore'
import type { Ref } from 'vue'

/**
 * 时间轴滚轮处理来源类型
 */
export enum TimelineWheelSource {
  /** 时间刻度区域 */
  TIME_SCALE = 'time_scale',
  /** 时间轴主体区域 */
  TIMELINE_BODY = 'timeline_body',
}

/**
 * 统一的时间轴滚轮处理模块
 * 提供时间轴和时间刻度区域的统一滚轮事件处理
 */
export function useTimelineWheelHandler(
  container: Ref<HTMLElement | undefined>,
  options?: {
    /** 滚轮事件来源（用于区分不同的处理逻辑） */
    source?: TimelineWheelSource
  },
) {
  const unifiedStore = useUnifiedStore()

  const defaultOptions = {
    source: TimelineWheelSource.TIME_SCALE,
    ...options,
  }

  function normalizeWheelDelta(delta: number, deltaMode: number): number {
    if (deltaMode === WheelEvent.DOM_DELTA_LINE) {
      return delta * 16
    }

    if (deltaMode === WheelEvent.DOM_DELTA_PAGE) {
      return delta * 100
    }

    return delta
  }

  function getPinchScaleFactor(deltaY: number): number {
    const rawScaleFactor = Math.exp(-deltaY * 0.0028)
    return Math.max(0.92, Math.min(rawScaleFactor, 1.08))
  }

  function getTimelineMouseX(event: WheelEvent, rect: DOMRect): number {
    let mouseX = event.clientX - rect.left

    if (defaultOptions.source === TimelineWheelSource.TIMELINE_BODY) {
      mouseX -= LayoutConstants.TRACK_CONTROL_WIDTH
    }

    return mouseX
  }

  function zoomAroundPointer(scaleFactor: number, event: WheelEvent) {
    const rect = container.value?.getBoundingClientRect()
    if (!rect) return

    const mouseX = getTimelineMouseX(event, rect)
    const mouseFrames = unifiedStore.pixelToFrame(mouseX, unifiedStore.TimelineContentWidth)

    unifiedStore.setZoomLevel(
      unifiedStore.zoomLevel * scaleFactor,
      unifiedStore.TimelineContentWidth,
    )

    const newMousePixel = unifiedStore.frameToPixel(mouseFrames, unifiedStore.TimelineContentWidth)
    const offsetAdjustment = newMousePixel - mouseX
    const newScrollOffset = unifiedStore.scrollOffset + offsetAdjustment

    unifiedStore.setScrollOffset(newScrollOffset, unifiedStore.TimelineContentWidth)
  }

  /**
   * 统一的滚轮事件处理
   */
  function handleWheel(event: WheelEvent) {
    const deltaX = normalizeWheelDelta(event.deltaX, event.deltaMode)
    const deltaY = normalizeWheelDelta(event.deltaY, event.deltaMode)
    const isPinchZoom = event.ctrlKey || event.metaKey
    const isKeyboardZoom = event.altKey
    const shouldZoom = isPinchZoom || isKeyboardZoom

    if (shouldZoom) {
      event.preventDefault()

      if (isPinchZoom) {
        const scaleFactor = getPinchScaleFactor(deltaY)
        zoomAroundPointer(scaleFactor, event)
        return
      }

      const scaleFactor = deltaY < 0 ? 1.1 : 1 / 1.1
      zoomAroundPointer(scaleFactor, event)
    } else if (event.shiftKey) {
      // Shift + 滚轮：水平滚动
      event.preventDefault()

      // 跨平台兼容：macOS 上 deltaX 有值，Windows 上 deltaY 有值
      const scrollAmount = deltaX !== 0 ? deltaX : deltaY

      if (scrollAmount < 0) {
        // 向左滚动
        unifiedStore.scrollLeft(-scrollAmount, unifiedStore.TimelineContentWidth)
      } else if (scrollAmount > 0) {
        // 向右滚动
        unifiedStore.scrollRight(scrollAmount, unifiedStore.TimelineContentWidth)
      }
    } else if (Math.abs(deltaX) > Math.abs(deltaY) && deltaX !== 0) {
      // 触摸板双指横向滑动：平移时间轴
      event.preventDefault()
      unifiedStore.setScrollOffset(
        unifiedStore.scrollOffset + deltaX,
        unifiedStore.TimelineContentWidth,
      )
    } else if (defaultOptions.source === TimelineWheelSource.TIME_SCALE) {
      // 时间刻度区域：普通滚轮不处理（保持原有行为）
      // 时间轴主体区域：普通滚轮允许垂直滚动（不阻止默认行为）
      // 这里不阻止默认行为，让浏览器处理垂直滚动
    }
  }

  return {
    handleWheel,
  }
}
