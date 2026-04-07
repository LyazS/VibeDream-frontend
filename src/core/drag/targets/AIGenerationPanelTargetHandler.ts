/**
 * AI生成面板拖拽目标处理器
 * 接受：素材项目、时间轴项目
 */

import type {
  DropTargetHandler,
  DropTargetType,
  UnifiedDragData,
  DropTargetInfo,
  DropResult,
  AIGenerationPanelDropTargetInfo,
  MediaItemDragData,
  TimelineItemDragData,
} from '@/core/types/drag'
import { DropTargetType as TargetType, DragSourceType } from '@/core/types/drag'
import type { UnifiedMediaModule } from '@/core/modules/UnifiedMediaModule'
import type { UnifiedTimelineModule } from '@/core/modules/UnifiedTimelineModule'
import type { UnifiedMediaItemData } from '@/core/mediaitem/types'

export class AIGenerationPanelTargetHandler implements DropTargetHandler {
  readonly targetType: DropTargetType = TargetType.AI_GENERATION_PANEL

  constructor(
    private mediaModule: UnifiedMediaModule,
    private timelineModule: UnifiedTimelineModule,
  ) {}

  canAccept(dragData: UnifiedDragData): boolean {
    // 只接受素材项目和时间轴项目
    return (
      dragData.sourceType === DragSourceType.ASSET ||
      dragData.sourceType === DragSourceType.MEDIA_ITEM ||
      dragData.sourceType === DragSourceType.TIMELINE_ITEM
    )
  }

  handleDragOver(
    event: DragEvent,
    dragData: UnifiedDragData,
    targetInfo: DropTargetInfo,
  ): boolean {
    if (targetInfo.targetType !== TargetType.AI_GENERATION_PANEL) {
      return false
    }

    const panelTargetInfo = targetInfo as AIGenerationPanelDropTargetInfo
    const acceptTypes = panelTargetInfo.fieldConfig.accept || []

    // 注意：不需要在这里检查文件数量限制
    // 因为组件的渐进式UI设计已经天然地限制了文件数量：
    // - 当达到 maxFiles 时，不会显示新的空槽位
    // - 用户只能拖拽到已填充的槽位进行替换操作
    // - 这是一个更优雅的用户体验设计

    // 检查文件类型兼容性
    if (dragData.sourceType === DragSourceType.ASSET || dragData.sourceType === DragSourceType.MEDIA_ITEM) {
      const mediaData = dragData as MediaItemDragData
      if (mediaData.assetKind !== 'media' || !mediaData.mediaType) {
        return false
      }
      return this.isMediaTypeAccepted(mediaData.mediaType, acceptTypes)
    } else if (dragData.sourceType === DragSourceType.TIMELINE_ITEM) {
      const timelineData = dragData as TimelineItemDragData
      const timelineItem = this.timelineModule.getTimelineItem(timelineData.itemId)
      if (!timelineItem) return false
      return this.isMediaTypeAccepted(timelineItem.mediaType, acceptTypes)
    }

    return false
  }

  async handleDrop(
    event: DragEvent,
    dragData: UnifiedDragData,
    targetInfo: DropTargetInfo,
  ): Promise<DropResult> {
    if (targetInfo.targetType !== TargetType.AI_GENERATION_PANEL) {
      console.error('目标类型不匹配，期望 AI_GENERATION_PANEL')
      return { success: false, error: '目标类型不匹配' }
    }

    const panelTargetInfo = targetInfo as AIGenerationPanelDropTargetInfo

    // 注意：不需要在这里检查文件数量限制
    // 因为组件的渐进式UI设计已经天然地限制了文件数量：
    // - 当达到 maxFiles 时，不会显示新的空槽位
    // - 用户只能拖拽到已填充的槽位进行替换操作
    // - 这是一个更优雅的用户体验设计

    try {
      if (dragData.sourceType === DragSourceType.ASSET || dragData.sourceType === DragSourceType.MEDIA_ITEM) {
        return await this.handleMediaItemDrop(dragData as MediaItemDragData, panelTargetInfo)
      } else if (dragData.sourceType === DragSourceType.TIMELINE_ITEM) {
        return await this.handleTimelineItemDrop(dragData as TimelineItemDragData, panelTargetInfo)
      }
    } catch (error) {
      console.error('处理拖拽放置失败:', error)
      return { success: false, error: '处理拖拽放置失败' }
    }

    return { success: false, error: '不支持的拖拽源类型' }
  }

  /**
   * 处理素材项目拖拽
   */
  private async handleMediaItemDrop(
    mediaData: MediaItemDragData,
    targetInfo: AIGenerationPanelDropTargetInfo,
  ): Promise<DropResult> {
    if (!mediaData.mediaItemId) {
      return { success: false, error: '该资产不是可渲染媒体' }
    }

    const mediaItem = this.mediaModule.getMediaItem(mediaData.mediaItemId)
    if (!mediaItem) {
      console.error('找不到素材项目:', mediaData.mediaItemId)
      return { success: false, error: '找不到素材项目' }
    }

    // 检查类型兼容性
    const acceptTypes = targetInfo.fieldConfig.accept || []
    if (!this.isMediaTypeAccepted(mediaItem.mediaType, acceptTypes)) {
      console.error(`素材类型 ${mediaItem.mediaType} 不被接受`)
      return { success: false, error: `不支持的素材类型: ${mediaItem.mediaType}` }
    }

    // 提取文件信息
    const fileData = {
      __type__: 'FileData' as const,
      name: mediaItem.name,
      mediaType: mediaItem.mediaType,
      mediaItemId: mediaItem.id,
      duration: mediaItem.duration,
      
      // 新增：分辨率信息
      resolution: mediaItem.runtime.bunny?.originalWidth ? {
        width: mediaItem.runtime.bunny.originalWidth,
        height: mediaItem.runtime.bunny.originalHeight,
      } : undefined,
      
      // 新增：来源标识
      source: 'media-item' as const,
    }

    console.log('✅ 素材拖拽成功:', fileData)
    
    // 返回成功结果和文件数据
    return {
      success: true,
      data: fileData,
    }
  }

  /**
   * 处理时间轴项目拖拽
   */
  private async handleTimelineItemDrop(
    timelineData: TimelineItemDragData,
    targetInfo: AIGenerationPanelDropTargetInfo,
  ): Promise<DropResult> {
    const timelineItem = this.timelineModule.getTimelineItem(timelineData.itemId)
    if (!timelineItem) {
      console.error('找不到时间轴项目:', timelineData.itemId)
      return { success: false, error: '找不到时间轴项目' }
    }

    // 检查类型兼容性
    const acceptTypes = targetInfo.fieldConfig.accept || []
    if (!this.isMediaTypeAccepted(timelineItem.mediaType, acceptTypes)) {
      console.error(`时间轴项目类型 ${timelineItem.mediaType} 不被接受`)
      return { success: false, error: `不支持的时间轴项目类型: ${timelineItem.mediaType}` }
    }

    // 获取关联的素材项目
    const mediaItem = this.mediaModule.getMediaItem(timelineItem.mediaItemId)
    if (!mediaItem) {
      console.error('找不到关联的素材项目:', timelineItem.mediaItemId)
      return { success: false, error: '找不到关联的素材项目' }
    }

    // 提取文件信息（包含时间范围）
    const fileData = {
      __type__: 'FileData' as const,
      name: mediaItem.name,
      mediaType: timelineItem.mediaType,
      timelineItemId: timelineItem.id,
      mediaItemId: mediaItem.id,
      duration: timelineItem.timeRange.timelineEndTime - timelineItem.timeRange.timelineStartTime,
      
      // 新增：分辨率信息
      resolution: mediaItem.runtime.bunny?.originalWidth ? {
        width: mediaItem.runtime.bunny.originalWidth,
        height: mediaItem.runtime.bunny.originalHeight,
      } : undefined,
      
      // 时间轴特有信息
      timeRange: {
        clipStartTime: timelineItem.timeRange.clipStartTime,
        clipEndTime: timelineItem.timeRange.clipEndTime,
        timelineStartTime: timelineItem.timeRange.timelineStartTime,
        timelineEndTime: timelineItem.timeRange.timelineEndTime,
      },
      
      // 新增：来源标识
      source: 'timeline-item' as const,
    }

    console.log('✅ 时间轴片段拖拽成功:', fileData)
    
    // 返回成功结果和文件数据
    return {
      success: true,
      data: fileData,
    }
  }

  /**
   * 检查媒体类型是否被接受
   */
  private isMediaTypeAccepted(mediaType: string, acceptTypes: string[]): boolean {
    if (acceptTypes.length === 0) return true // 未指定则接受所有类型
    return acceptTypes.includes(mediaType)
  }
}
