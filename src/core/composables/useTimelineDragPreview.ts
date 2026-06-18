/**
 * CleanTimeline 拖拽预览管理
 * 负责处理从素材库拖拽到时间轴时的实时预览功能
 */

import { DragSourceType } from '@/core/types/drag'
import type {
  MediaItemDragData,
  TimelineItemDragData,
  UnifiedDragData,
} from '@/core/types/drag'
import { getDefaultTrackHeight } from '@/core/track/TrackUtils'
import type { UnifiedTrackData } from '@/core/track/TrackTypes'
import type { EffectTemplatePreviewData } from '@/core/effect-template/types'
import type { UnifiedMediaItemData } from '@/core/mediaitem/types'
import type { UnifiedTimelineItemData } from '@/core/timelineitem/type'

interface TimelineDragPreviewDeps {
  frameToPixel: (frames: number) => number
  getCurrentDragData: (event: DragEvent) => UnifiedDragData | null
  getMediaItem: (id: string) => UnifiedMediaItemData | undefined
  getTimelineItemsByTrack: (trackId: string) => UnifiedTimelineItemData[]
  getTrack: (trackId: string) => UnifiedTrackData | undefined
}

/**
 * 拖拽预览管理 Composable
 * @param deps - 依赖的方法和数据
 */
export function useTimelineDragPreview(deps: TimelineDragPreviewDeps) {
  // 预览元素引用
  let previewElement: HTMLElement | null = null

  /**
   * 创建预览元素
   */
  function createPreviewElement(): HTMLElement {
    const el = document.createElement('div')
    el.className = 'timeline-drag-preview'
    el.style.cssText = `
      position: fixed;
      left: 0;
      top: 0;
      pointer-events: none;
      z-index: 10001;
      border-radius: 4px;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 11px;
      font-weight: 500;
      color: white;
      text-shadow: 0 1px 2px rgba(0, 0, 0, 0.8);
      box-shadow: 0 2px 8px rgba(0, 0, 0, 0.3);
      opacity: 0.9;
      transition: none;
    `
    return el
  }

  /**
   * 显示预览
   */
  function showPreview(
    trackId: string,
    startFrame: number,
    durationFrames: number,
    name: string,
    status: 'compatible' | 'conflict' | 'incompatible',
  ) {
    if (!previewElement) {
      previewElement = createPreviewElement()
      document.body.appendChild(previewElement)
    }

    // 蓝色：兼容无冲突
    // 黄色：有冲突
    // 红色：轨道不兼容
    let bgColor: string
    let borderColor: string

    if (status === 'incompatible') {
      // 不兼容状态显示红色叉，使用半透明样式
      previewElement.innerHTML = `
        <svg width="40" height="40" viewBox="0 0 40 40" fill="none" xmlns="http://www.w3.org/2000/svg">
          <path d="M10 10 L30 30 M30 10 L10 30" stroke="#ef4444" stroke-width="4" stroke-linecap="round"/>
        </svg>
      `
      bgColor = 'rgba(239, 68, 68, 0.3)'
      borderColor = '#ef4444'
    } else {
      // 兼容和冲突状态显示文本
      previewElement.textContent = name.length > 12 ? name.substring(0, 10) + '..' : name

      if (status === 'conflict') {
        bgColor = 'rgba(234, 179, 8, 0.3)' // 黄色
        borderColor = '#eab308'
      } else {
        bgColor = 'rgba(59, 130, 246, 0.3)' // 蓝色
        borderColor = '#3b82f6'
      }
    }

    previewElement.style.background = bgColor
    previewElement.style.border = `2px solid ${borderColor}`

    updatePreviewPosition(trackId, startFrame, durationFrames, status)
  }

  function showEffectTemplatePreview(trackId: string, preview: EffectTemplatePreviewData) {
    if (!previewElement) {
      previewElement = createPreviewElement()
      document.body.appendChild(previewElement)
    }

    previewElement.innerHTML = `
      <div style="position:absolute;inset:0;background:linear-gradient(90deg,rgba(59,130,246,0.12),rgba(59,130,246,0.42));border-radius:4px;"></div>
      <div style="position:absolute;top:2px;left:6px;font-size:10px;font-weight:600;color:#dbeafe;text-shadow:none;">${preview.label}</div>
      <div style="position:absolute;top:-2px;right:-1px;width:2px;height:calc(100% + 4px);background:#93c5fd;box-shadow:0 0 0 1px rgba(15,23,42,0.25);"></div>
    `
    previewElement.style.background = 'rgba(30, 64, 175, 0.18)'
    previewElement.style.border = '1px solid rgba(147, 197, 253, 0.9)'
    previewElement.style.borderRadius = '4px'
    previewElement.style.overflow = 'visible'

    updatePreviewPosition(trackId, preview.startFrame, preview.durationFrames, 'compatible')
  }

  /**
   * 更新预览位置
   * 使用 transform 而非 left/top 以获得更好的性能
   */
  function updatePreviewPosition(
    trackId: string,
    startFrame: number,
    durationFrames: number,
    status: 'compatible' | 'conflict' | 'incompatible',
  ) {
    if (!previewElement) return

    const trackElement = document.querySelector(
      `.track-content[data-track-id="${trackId}"]`,
    ) as HTMLElement

    if (!trackElement) return

    const trackRect = trackElement.getBoundingClientRect()

    // frameToPixel 返回的是相对于可见区域的像素位置
    // 不需要再减去滚动偏移，因为已经在 frameToPixel 内部处理了
    const startX = deps.frameToPixel(startFrame)
    const endX = deps.frameToPixel(startFrame + durationFrames)
    const width = Math.max(endX - startX, 0)

    const track = deps.getTrack(trackId)
    const trackHeight = track?.height || getDefaultTrackHeight(track?.type || 'video')
    // 预览高度应该根据轨道类型动态调整，而不是固定为60px
    const previewHeight = trackHeight - 10 // 减去上下各5px的间距
    const topOffset = Math.max(5, (trackHeight - previewHeight) / 2)

    // trackRect.left 是轨道在屏幕上的绝对位置
    // startX 是帧在时间轴内容区域的相对位置
    // 直接相加即可
    const finalLeft = trackRect.left + startX
    const finalTop = trackRect.top + topOffset

    previewElement.style.transform = `translate(${finalLeft}px, ${finalTop}px)`

    // 不兼容状态使用固定宽度，其他状态使用计算出的宽度
    const finalWidth = status === 'incompatible' ? 40 : width
    previewElement.style.width = `${finalWidth}px`
    previewElement.style.height = `${previewHeight}px`
  }

  /**
   * 隐藏预览
   */
  function hidePreview() {
    if (previewElement) {
      previewElement.remove()
      previewElement = null
    }
  }

  /**
   * 检测冲突
   */
  function hasConflict(trackId: string, startFrame: number, durationFrames: number): boolean {
    const trackItems = deps.getTimelineItemsByTrack(trackId)
    const endFrame = startFrame + durationFrames

    for (const item of trackItems) {
      const itemStart = item.timeRange.timelineStartTime
      const itemEnd = item.timeRange.timelineEndTime

      if (startFrame < itemEnd && endFrame > itemStart) {
        return true
      }
    }

    return false
  }

  /**
   * 处理拖拽预览（支持素材库和时间轴项目拖拽）
   */
  function handleDragPreview(
    event: DragEvent,
    targetTrackId: string,
    dropTime: number,
    effectPreview?: EffectTemplatePreviewData | null,
  ) {
    const dragData = deps.getCurrentDragData(event)

    if (!dragData) {
      hidePreview()
      return
    }

    if (dragData.sourceType === DragSourceType.ASSET || dragData.sourceType === DragSourceType.MEDIA_ITEM) {
      handleMediaItemPreview(dragData, targetTrackId, dropTime, effectPreview)
    } else if (dragData.sourceType === DragSourceType.TIMELINE_ITEM) {
      handleTimelineItemPreview(dragData, targetTrackId, dropTime)
    } else {
      hidePreview()
    }
  }

  /**
   * 检查轨道兼容性
   */
  function checkTrackCompatibility(mediaType: string, trackType: string): boolean {
    // 视频和图片可以放到视频轨道
    if ((mediaType === 'video' || mediaType === 'image') && trackType === 'video') {
      return true
    }
    // 音频只能放到音频轨道
    if (mediaType === 'audio' && trackType === 'audio') {
      return true
    }
    // 文本只能放到文本轨道
    if (mediaType === 'text' && trackType === 'text') {
      return true
    }
    return false
  }

  /**
   * 处理素材拖拽预览
   */
  function handleMediaItemPreview(
    dragData: MediaItemDragData,
    targetTrackId: string,
    dropTime: number,
    effectPreview?: EffectTemplatePreviewData | null,
  ) {
    try {
      if (dragData.assetKind === 'effect-template') {
        if (effectPreview) {
          showEffectTemplatePreview(targetTrackId, effectPreview)
        } else {
          hidePreview()
        }
        return
      }

      const mediaItem = dragData.assetKind === 'media'
        ? deps.getMediaItem(dragData.assetId)
        : null
      if (!mediaItem) {
        hidePreview()
        return
      }

      const track = deps.getTrack(targetTrackId)
      if (!track) {
        hidePreview()
        return
      }

      // 检查轨道兼容性
      const isCompatible = checkTrackCompatibility(mediaItem.mediaType, track.type)

      const duration = dragData.duration ?? 0

      // 检查时间冲突
      const hasTimeConflict = hasConflict(targetTrackId, dropTime, duration)

      // 确定预览状态
      let status: 'compatible' | 'conflict' | 'incompatible'
      if (!isCompatible) {
        status = 'incompatible' // 红色：轨道不兼容
      } else if (hasTimeConflict) {
        status = 'conflict' // 黄色：有冲突
      } else {
        status = 'compatible' // 蓝色：可以放置
      }

      showPreview(targetTrackId, dropTime, duration, dragData.name, status)
    } catch (error) {
      console.error('[TimelineDragPreview] 素材预览失败:', error)
      hidePreview()
    }
  }

  /**
   * 处理时间轴项目拖拽预览
   */
  function handleTimelineItemPreview(
    dragData: TimelineItemDragData,
    targetTrackId: string,
    dropTime: number,
  ) {
    try {
      const timelineItem = deps
        .getTimelineItemsByTrack(dragData.trackId)
        .find((item) => item.id === dragData.timelineItemId)

      if (!timelineItem) {
        hidePreview()
        return
      }

      const track = deps.getTrack(targetTrackId)
      if (!track) {
        hidePreview()
        return
      }

      // 获取时间轴项目的时长
      const duration =
        timelineItem.timeRange.timelineEndTime - timelineItem.timeRange.timelineStartTime

      // 检查轨道兼容性
      const isCompatible = checkTrackCompatibility(timelineItem.mediaType, track.type)

      // 检查时间冲突（排除当前拖拽的项目）
      const excludeIds = [dragData.timelineItemId, ...(dragData.selectedItems || [])]
      const hasTimeConflict = hasConflictWithExclusions(
        targetTrackId,
        dropTime,
        duration,
        excludeIds,
      )

      // 确定预览状态
      let status: 'compatible' | 'conflict' | 'incompatible'
      if (!isCompatible) {
        status = 'incompatible' // 红色：轨道不兼容
      } else if (hasTimeConflict) {
        status = 'conflict' // 黄色：有冲突
      } else {
        status = 'compatible' // 蓝色：可以放置
      }

      // 使用时间轴项目的名称，如果没有则使用默认名称
      const mediaItem = timelineItem.mediaItemId ? deps.getMediaItem(timelineItem.mediaItemId) : undefined
      const itemName = mediaItem?.name || timelineItem.mediaType || '片段'

      showPreview(targetTrackId, dropTime, duration, itemName, status)
    } catch (error) {
      console.error('[TimelineDragPreview] 时间轴项目预览失败:', error)
      hidePreview()
    }
  }

  /**
   * 检测冲突（支持排除特定项目）
   */
  function hasConflictWithExclusions(
    trackId: string,
    startFrame: number,
    durationFrames: number,
    excludeIds: string[] = [],
  ): boolean {
    const trackItems = deps.getTimelineItemsByTrack(trackId)
    const endFrame = startFrame + durationFrames

    for (const item of trackItems) {
      // 排除指定的项目
      if (excludeIds.includes(item.id)) {
        continue
      }

      const itemStart = item.timeRange.timelineStartTime
      const itemEnd = item.timeRange.timelineEndTime

      if (startFrame < itemEnd && endFrame > itemStart) {
        return true
      }
    }

    return false
  }

  return {
    handleDragPreview,
    hidePreview,
  }
}
