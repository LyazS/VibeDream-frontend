/**
 * 时间轴轨道拖拽目标处理器
 * 接受：素材项目、时间轴项目
 */

import type {
  DropTargetHandler,
  DropTargetType,
  UnifiedDragData,
  DropTargetInfo,
  TimelineTrackDropTargetInfo,
  DragPreviewData,
  MediaItemDragData,
  TimelineItemDragData,
  DropResult,
} from '@/core/types/drag'
import { DropTargetType as TargetType, DragSourceType } from '@/core/types/drag'
import type { UnifiedTimelineModule } from '@/core/modules/UnifiedTimelineModule'
import type { UnifiedSelectionModule } from '@/core/modules/UnifiedSelectionModule'
import type { UnifiedTrackModule } from '@/core/modules/UnifiedTrackModule'
import type { UnifiedTrackData } from '@/core/track/TrackTypes'
import { useTimelineItemOperations } from '@/core/composables/useTimelineItemOperations'
import { alignFramesToFrame } from '@/core/utils/timeUtils'
import { effectTemplateHandlerRegistry } from '@/core/effect-template/registry'
import { useUnifiedStore } from '@/core/unifiedStore'

export class TimelineTrackTargetHandler implements DropTargetHandler {
  readonly targetType: DropTargetType = TargetType.TIMELINE_TRACK

  private timelineItemOperations = useTimelineItemOperations()

  constructor(
    private timelineModule: UnifiedTimelineModule,
    private selectionModule: UnifiedSelectionModule,
    private trackModule: UnifiedTrackModule,
  ) {}

  canAccept(dragData: UnifiedDragData): boolean {
    // 只接受素材项目和时间轴项目
    return (
      dragData.sourceType === DragSourceType.ASSET ||
      dragData.sourceType === DragSourceType.MEDIA_ITEM ||
      dragData.sourceType === DragSourceType.TIMELINE_ITEM
    )
  }

  handleDragOver(event: DragEvent, dragData: UnifiedDragData, targetInfo: DropTargetInfo): boolean {
    // 类型检查
    if (targetInfo.targetType !== TargetType.TIMELINE_TRACK) {
      return false
    }
    
    const trackTargetInfo = targetInfo as TimelineTrackDropTargetInfo
    
    // 1. 获取目标轨道
    const targetTrack = this.trackModule.getTrack(trackTargetInfo.targetId)
    if (!targetTrack) {
      return false
    }

    // 2. 根据拖拽源类型处理
    if (dragData.sourceType === DragSourceType.ASSET || dragData.sourceType === DragSourceType.MEDIA_ITEM) {
      const mediaData = dragData as MediaItemDragData

      if (mediaData.assetKind === 'effect-template') {
        return this.canDropEffectTemplate(mediaData, trackTargetInfo, targetTrack)
      }

      // 检查轨道兼容性
      const isCompatible = this.isMediaCompatibleWithTrack(mediaData.mediaType || 'unknown', targetTrack.type)

      if (!isCompatible) {
        return false
      }

      return true
    } else if (dragData.sourceType === DragSourceType.TIMELINE_ITEM) {
      const timelineData = dragData as TimelineItemDragData

      // 获取时间轴项目信息
      const timelineItem = this.timelineModule.getTimelineItem(timelineData.timelineItemId)
      if (!timelineItem) {
        return false
      }

      // 检查轨道兼容性
      const isCompatible = this.isMediaCompatibleWithTrack(timelineItem.mediaType, targetTrack.type)

      if (!isCompatible) {
        return false
      }

      return true
    }

    return false
  }

  async handleDrop(
    event: DragEvent,
    dragData: UnifiedDragData,
    targetInfo: DropTargetInfo,
  ): Promise<DropResult> {
    // 1. 目标类型检查
    if (targetInfo.targetType !== TargetType.TIMELINE_TRACK) {
      console.error('目标类型不匹配，期望 TIMELINE_TRACK')
      return { success: false }
    }

    const trackTargetInfo = targetInfo as TimelineTrackDropTargetInfo
    
    // 2. 获取目标轨道
    const targetTrack = this.trackModule.getTrack(trackTargetInfo.targetId)
    if (!targetTrack) {
      console.error('目标轨道不存在')
      return { success: false }
    }

    // 3. 根据拖拽源类型处理
    if (dragData.sourceType === DragSourceType.ASSET || dragData.sourceType === DragSourceType.MEDIA_ITEM) {
      return this.handleMediaItemDrop(dragData as MediaItemDragData, trackTargetInfo, targetTrack)
    } else if (dragData.sourceType === DragSourceType.TIMELINE_ITEM) {
      return this.handleTimelineItemDrop(dragData, trackTargetInfo, targetTrack)
    }

    console.error('不支持的拖拽源类型')
    return { success: false }
  }

  /**
   * 处理素材项目拖拽放置
   */
  private async handleMediaItemDrop(
    mediaData: MediaItemDragData,
    targetInfo: TimelineTrackDropTargetInfo,
    targetTrack: UnifiedTrackData,
  ): Promise<DropResult> {
    // 1. 检查兼容性
    if (mediaData.assetKind === 'effect-template') {
      return this.handleEffectTemplateDrop(mediaData, targetInfo, targetTrack)
    }

    const isCompatible = this.isMediaCompatibleWithTrack(mediaData.mediaType || 'unknown', targetTrack.type)

    if (!isCompatible) {
      console.error(`${mediaData.mediaType} 类型的素材不能放置到 ${targetTrack.type} 轨道`)
      return { success: false }
    }

    // 2. 计算放置位置（帧数）
    const dropTimeFrames = targetInfo.position.time

    // 3. 对齐到帧边界
    const alignedDropTime = alignFramesToFrame(dropTimeFrames)

    // 4. 确保位置不小于0
    const finalDropTime = Math.max(0, alignedDropTime)

    // 5. 调用 createTimelineItemFromMediaItem 创建片段
    try {
      if (mediaData.assetKind !== 'media') {
        return { success: false }
      }

      await this.timelineItemOperations.createTimelineItemFromMediaItem(
        mediaData.assetId,
        finalDropTime,
        targetInfo.targetId,
      )

      console.log(`✅ 成功创建时间轴片段:`, {
        mediaItemId: mediaData.assetId,
        trackId: targetInfo.targetId,
        startTime: finalDropTime,
      })

      return { success: true }
    } catch (error) {
      console.error('创建时间轴片段失败:', error)
      return { success: false }
    }
  }

  private canDropEffectTemplate(
    mediaData: MediaItemDragData,
    targetInfo: TimelineTrackDropTargetInfo,
    targetTrack: UnifiedTrackData,
  ): boolean {
    const store = useUnifiedStore()
    const handler = effectTemplateHandlerRegistry.get(mediaData.effectType)
    if (!handler) {
      return false
    }

    const candidate = handler.resolveDropCandidate({
      dragData: mediaData,
      targetTrack,
      trackItems: store.getTimelineItemsByTrack(targetInfo.targetId),
      hoveredFrame: targetInfo.position.time,
      thresholdFrames: this.resolveSnapThresholdFrames(),
    })

    return candidate.canDrop
  }

  private async handleEffectTemplateDrop(
    mediaData: MediaItemDragData,
    targetInfo: TimelineTrackDropTargetInfo,
    targetTrack: UnifiedTrackData,
  ): Promise<DropResult> {
    const store = useUnifiedStore()
    const handler = effectTemplateHandlerRegistry.get(mediaData.effectType)
    if (!handler) {
      return { success: false }
    }

    const candidate = handler.resolveDropCandidate({
      dragData: mediaData,
      targetTrack,
      trackItems: store.getTimelineItemsByTrack(targetInfo.targetId),
      hoveredFrame: targetInfo.position.time,
      thresholdFrames: this.resolveSnapThresholdFrames(),
    })

    if (!candidate.canDrop) {
      return candidate.invalidReason
        ? { success: false, error: candidate.invalidReason }
        : { success: false }
    }

    return handler.applyTemplate({
      dragData: mediaData,
      targetTrack,
      candidate,
    })
  }

  /**
   * 处理时间轴项目拖拽放置
   */
  private async handleTimelineItemDrop(
    dragData: UnifiedDragData,
    targetInfo: TimelineTrackDropTargetInfo,
    targetTrack: UnifiedTrackData,
  ): Promise<DropResult> {
    // 类型转换
    const timelineData = dragData as TimelineItemDragData

    // 1. 获取时间轴项目信息
    const timelineItem = this.timelineModule.getTimelineItem(timelineData.timelineItemId)
    if (!timelineItem) {
      console.error('找不到时间轴项目:', timelineData.timelineItemId)
      return { success: false }
    }

    // 2. 检查轨道兼容性
    const isCompatible = this.isMediaCompatibleWithTrack(timelineItem.mediaType, targetTrack.type)

    if (!isCompatible) {
      console.error(`${timelineItem.mediaType} 类型的项目不能放置到 ${targetTrack.type} 轨道`)
      return { success: false }
    }

    // 3. 计算最终位置（考虑拖拽偏移量）
    const dropTimeFrames = targetInfo.position.time
    const alignedDropTime = alignFramesToFrame(dropTimeFrames)
    const finalDropTime = Math.max(0, alignedDropTime)

    // 4. 调用 moveSingleItem 移动项目
    try {
      await this.timelineItemOperations.moveSingleItem(
        timelineData.timelineItemId,
        finalDropTime,
        targetInfo.targetId,
      )

      console.log(`✅ 成功移动时间轴项目:`, {
        timelineItemId: timelineData.timelineItemId,
        trackId: targetInfo.targetId,
        startTime: finalDropTime,
      })

      return { success: true }
    } catch (error) {
      console.error('移动时间轴项目失败:', error)
      return { success: false }
    }
  }

  /**
   * 检查素材类型是否与轨道类型兼容
   */
  private isMediaCompatibleWithTrack(mediaType: string, trackType: string): boolean {
    // 视频轨道：接受视频和图片
    if (trackType === 'video') {
      return mediaType === 'video' || mediaType === 'image'
    }

    // 音频轨道：只接受音频
    if (trackType === 'audio') {
      return mediaType === 'audio'
    }

    // 文本轨道：只接受文本
    if (trackType === 'text' || trackType === 'subtitle') {
      return mediaType === 'text'
    }

    return false
  }

  private resolveSnapThresholdFrames(): number {
    const store = useUnifiedStore()
    const totalDurationFrames = store.totalDurationFrames
    const timelineWidth = store.TimelineContentWidth
    const zoomLevel = store.zoomLevel
    const pixelsPerFrame = (timelineWidth * zoomLevel) / Math.max(1, totalDurationFrames)
    const threshold = store.snapConfig.threshold
    return threshold / Math.max(pixelsPerFrame, 0.0001)
  }
}
