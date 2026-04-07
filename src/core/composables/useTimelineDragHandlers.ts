import { ref, type Ref } from 'vue'
import { useUnifiedStore } from '@/core/unifiedStore'
import { LayoutConstants } from '@/constants/LayoutConstants'
import {
  DropTargetType,
  DragSourceType,
  type DropTargetInfo,
  type MediaItemDragData,
  type TimelineItemDragData,
} from '@/core/types/drag'
import { effectTemplateHandlerRegistry } from '@/core/effect-template/registry'

/**
 * 时间轴拖拽处理 Composable
 * 提供 handleTimelineDragOver 和 handleTimelineDrop 功能
 */
export function useTimelineDragHandlers(
  timelineBody: Ref<HTMLElement | undefined>,
  snapFunctions: {
    calculateSnapPosition: Function
    updateSnapIndicator: Function
    clearSnapIndicator: Function
    calculateMouseXInTimeline: Function
  },
  dragPreviewFunctions: {
    handleDragPreview: Function
    hidePreview: Function
  },
) {
  const unifiedStore = useUnifiedStore()

  // 解构吸附函数
  const {
    calculateSnapPosition,
    updateSnapIndicator,
    clearSnapIndicator,
    calculateMouseXInTimeline,
  } = snapFunctions

  // 解构拖拽预览函数
  const { handleDragPreview, hidePreview } = dragPreviewFunctions

  /**
   * 查找目标轨道（通过事件委托）
   * 性能优化：使用 closest() API 替代手动 DOM 遍历
   */
  function findTargetTrack(
    element: HTMLElement | null,
  ): { trackId: string; trackType: string } | null {
    if (!element) return null

    // 使用 closest() 查找最近的 track-content 元素（性能更好）
    const trackContent = element.closest('.track-content') as HTMLElement | null

    if (!trackContent) return null

    // 提前检查是否超出 timeline-body 范围
    if (!timelineBody.value?.contains(trackContent)) return null

    const trackId = trackContent.dataset.trackId
    const trackType = trackContent.dataset.trackType

    // 使用 dataset API 比 getAttribute 更快
    if (trackId && trackType) {
      return { trackId, trackType }
    }

    return null
  }

  /**
   * 处理时间轴拖拽悬停
   */
  function handleTimelineDragOver(event: DragEvent) {
    event.preventDefault()
    event.stopPropagation()

    // 1. 查找目标轨道
    const targetTrack = findTargetTrack(event.target as HTMLElement)
    if (!targetTrack) {
      hidePreview()
      clearSnapIndicator()
      return
    }

    // 2. 计算鼠标在时间轴内容区域的X坐标
    if (!timelineBody.value) return
    const mouseX = calculateMouseXInTimeline(
      event,
      timelineBody.value,
      LayoutConstants.TRACK_CONTROL_WIDTH,
    )

    // 3. 获取拖拽数据
    const dragData = unifiedStore.getCurrentDragData(event)
    if (!dragData) {
      hidePreview()
      clearSnapIndicator()
      return
    }

    // 4. 先用原始位置创建目标信息，检查轨道兼容性
    const originalFrame = unifiedStore.pixelToFrame(mouseX, unifiedStore.TimelineContentWidth)
    const targetInfo: DropTargetInfo = {
      targetType: DropTargetType.TIMELINE_TRACK,
      targetId: targetTrack.trackId,
      position: {
        time: originalFrame,
        x: event.clientX,
        y: event.clientY,
      },
    }

    // 5. 调用拖拽管理器判断是否允许放置（检查轨道兼容性）
    const canDrop = unifiedStore.handleDragOver(event, targetInfo)

    // 6. 根据拖拽数据类型进行不同的处理
    let finalFrame = originalFrame
    let clipDuration: number | undefined
    let excludeClipIds: string[] = []
    let adjustedMouseX = mouseX // 用于存储考虑拖拽偏移后的鼠标位置

    if (canDrop) {
      if (dragData.sourceType === DragSourceType.ASSET || dragData.sourceType === DragSourceType.MEDIA_ITEM) {
        // MediaItemDragData 处理
        const mediaData = dragData as MediaItemDragData

        if (mediaData.assetKind === 'effect-template') {
          const track = unifiedStore.getTrack(targetTrack.trackId)
          const handler = effectTemplateHandlerRegistry.get(mediaData.effectType)
          const candidate =
            track && handler
              ? handler.resolveDropCandidate({
                  dragData: mediaData,
                  targetTrack: track,
                  trackItems: unifiedStore.getTimelineItemsByTrack(targetTrack.trackId),
                  hoveredFrame: originalFrame,
                  thresholdFrames: resolveSnapThresholdFrames(),
                })
              : null

          if (candidate?.canDrop && candidate.snappedFrame !== null) {
            finalFrame = candidate.snappedFrame
            updateSnapIndicator({
              snapped: true,
              frame: finalFrame,
              snapPoint: {
                type: 'clip-end',
                frame: finalFrame,
                priority: 1,
                clipId: (candidate as any).sourceItemId!,
                clipName: '',
              },
              distance: Math.abs(finalFrame - originalFrame),
            })
            targetInfo.position.time = finalFrame
          } else {
            clearSnapIndicator()
          }

          if (candidate?.canDrop && candidate.preview) {
            handleDragPreview(event, targetTrack.trackId, finalFrame, candidate.preview)
          } else {
            hidePreview()
          }
          return
        }

        // 获取素材时长（用于尾部吸附）
        const mediaItem = unifiedStore.getMediaItem(mediaData.mediaItemId ?? null)
        if (mediaItem && mediaItem.duration) {
          clipDuration = mediaItem.duration
        }

        // 素材库拖拽不需要排除任何片段
        excludeClipIds = []
      } else if (dragData.sourceType === DragSourceType.TIMELINE_ITEM) {
        // TimelineItemDragData 处理
        const timelineData = dragData as TimelineItemDragData

        // 获取时间轴项目信息
        const timelineItem = unifiedStore.getTimelineItem(timelineData.itemId)
        if (timelineItem) {
          // 使用时间轴项目的时长
          clipDuration =
            timelineItem.timeRange.timelineEndTime - timelineItem.timeRange.timelineStartTime

          // 排除当前拖拽的项目（避免自我吸附）
          excludeClipIds = [timelineData.itemId]

          // 如果是多选，排除所有选中的项目
          if (timelineData.selectedItems && timelineData.selectedItems.length > 0) {
            excludeClipIds = [...excludeClipIds, ...timelineData.selectedItems]
          }

          // 应用拖拽偏移量：调整鼠标位置以反映实际的拖拽起始点
          if (timelineData.dragOffset) {
            // 调整鼠标X位置，考虑拖拽偏移
            adjustedMouseX = mouseX - timelineData.dragOffset.x
          }
        }
      }

      const snapResult = calculateSnapPosition({
        mouseX: adjustedMouseX, // 使用调整后的鼠标位置
        timelineWidth: unifiedStore.TimelineContentWidth,
        excludeClipIds,
        clipDuration, // 传入时长以支持尾部吸附
      })

      finalFrame = snapResult.frame

      // 7. 更新吸附指示器状态
      updateSnapIndicator(snapResult, clipDuration)

      // 8. 使用吸附后的位置更新目标信息
      targetInfo.position.time = finalFrame
    } else {
      // 不兼容时清除吸附指示器
      clearSnapIndicator()
    }

    // 9. 显示预览（使用最终位置）
    handleDragPreview(event, targetTrack.trackId, finalFrame)
  }

  /**
   * 处理时间轴拖拽放置
   */
  async function handleTimelineDrop(event: DragEvent) {
    event.preventDefault()
    event.stopPropagation()

    // 清理预览和吸附指示器
    hidePreview()
    clearSnapIndicator()

    // 1. 查找目标轨道
    const targetTrack = findTargetTrack(event.target as HTMLElement)
    if (!targetTrack) {
      console.warn('未找到目标轨道')
      return
    }

    // 2. 计算鼠标在时间轴内容区域的X坐标
    if (!timelineBody.value) return
    const mouseX = calculateMouseXInTimeline(
      event,
      timelineBody.value,
      LayoutConstants.TRACK_CONTROL_WIDTH,
    )

    // 3. 获取拖拽数据
    const dragData = unifiedStore.getCurrentDragData(event)
    if (!dragData) {
      console.warn('未找到拖拽数据')
      return
    }

    // 4. 根据拖拽数据类型获取时长和排除项
    let clipDuration: number | undefined
    let excludeClipIds: string[] = []
    let adjustedMouseX = mouseX // 用于存储考虑拖拽偏移后的鼠标位置

    if (dragData.sourceType === DragSourceType.ASSET || dragData.sourceType === DragSourceType.MEDIA_ITEM) {
      // MediaItemDragData 处理
      const mediaData = dragData as MediaItemDragData

      if (mediaData.assetKind === 'effect-template') {
        const track = unifiedStore.getTrack(targetTrack.trackId)
        const handler = effectTemplateHandlerRegistry.get(mediaData.effectType)
        const candidate =
          track && handler
            ? handler.resolveDropCandidate({
                dragData: mediaData,
                targetTrack: track,
                trackItems: unifiedStore.getTimelineItemsByTrack(targetTrack.trackId),
                hoveredFrame: unifiedStore.pixelToFrame(mouseX, unifiedStore.TimelineContentWidth),
                thresholdFrames: resolveSnapThresholdFrames(),
              })
            : null

        const targetInfo: DropTargetInfo = {
          targetType: DropTargetType.TIMELINE_TRACK,
          targetId: targetTrack.trackId,
          position: {
            time: candidate?.canDrop && candidate.snappedFrame !== null
              ? candidate.snappedFrame
              : unifiedStore.pixelToFrame(mouseX, unifiedStore.TimelineContentWidth),
            x: event.clientX,
            y: event.clientY,
          },
        }

        await unifiedStore.handleDrop(event, targetInfo)
        return
      }

      // 获取素材时长（用于尾部吸附）
      const mediaItem = unifiedStore.getMediaItem(mediaData.mediaItemId ?? null)
      if (mediaItem && mediaItem.duration) {
        clipDuration = mediaItem.duration
      }

      // 素材库拖拽不需要排除任何片段
      excludeClipIds = []
    } else if (dragData.sourceType === DragSourceType.TIMELINE_ITEM) {
      // TimelineItemDragData 处理
      const timelineData = dragData as TimelineItemDragData

      // 获取时间轴项目信息
      const timelineItem = unifiedStore.getTimelineItem(timelineData.itemId)
      if (timelineItem) {
        // 使用时间轴项目的时长
        clipDuration =
          timelineItem.timeRange.timelineEndTime - timelineItem.timeRange.timelineStartTime

        // 排除当前拖拽的项目（避免自我吸附）
        excludeClipIds = [timelineData.itemId]

        // 如果是多选，排除所有选中的项目
        if (timelineData.selectedItems && timelineData.selectedItems.length > 0) {
          excludeClipIds = [...excludeClipIds, ...timelineData.selectedItems]
        }

        // 应用拖拽偏移量：调整鼠标位置以反映实际的拖拽起始点
        if (timelineData.dragOffset) {
          // 调整鼠标X位置，考虑拖拽偏移
          adjustedMouseX = mouseX - timelineData.dragOffset.x
        }
      }
    }

    // 5. 计算吸附位置（支持头部和尾部吸附）
    const snapResult = calculateSnapPosition({
      mouseX: adjustedMouseX, // 使用调整后的鼠标位置
      timelineWidth: unifiedStore.TimelineContentWidth,
      excludeClipIds,
      clipDuration, // 传入时长以支持尾部吸附
    })

    // 6. 创建目标信息（使用吸附后的位置）
    const targetInfo: DropTargetInfo = {
      targetType: DropTargetType.TIMELINE_TRACK,
      targetId: targetTrack.trackId,
      position: {
        time: snapResult.frame, // 使用吸附后的帧位置
        x: event.clientX,
        y: event.clientY,
      },
    }

    // 7. 调用拖拽管理器处理放置
    await unifiedStore.handleDrop(event, targetInfo)
  }

  /**
   * 处理拖拽离开时间轴
   */
  function handleTimelineDragLeave(event: DragEvent) {
    // 只在真正离开 timeline-body 时隐藏预览
    const relatedTarget = event.relatedTarget as HTMLElement
    if (!timelineBody.value?.contains(relatedTarget)) {
      hidePreview()
      clearSnapIndicator()
    }
  }

  /**
   * 处理拖拽结束
   */
  function handleTimelineDragEnd(event: DragEvent) {
    hidePreview()
    clearSnapIndicator()
  }

  function resolveSnapThresholdFrames(): number {
    const pixelsPerFrame =
      (unifiedStore.TimelineContentWidth * unifiedStore.zoomLevel) /
      Math.max(1, unifiedStore.totalDurationFrames)
    return unifiedStore.snapConfig.threshold / Math.max(pixelsPerFrame, 0.0001)
  }

  return {
    handleTimelineDragOver,
    handleTimelineDrop,
    handleTimelineDragLeave,
    handleTimelineDragEnd,
    findTargetTrack,
  }
}
