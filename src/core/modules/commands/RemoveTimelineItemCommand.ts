/**
 * 移除时间轴项目命令
 * 支持移除已知和未知时间轴项目的撤销/重做操作
 * 遵循"从源头重建"原则：保存完整的重建元数据，撤销时从原始素材重新创建
 */
import type { Ref } from 'vue'
import { generateCommandId } from '@/core/utils/idGenerator'
import type { SimpleCommand } from '@/core/modules/commands/types'

// ==================== 新架构类型导入 ====================
import type { UnifiedTimelineItemData } from '@/core/timelineitem/type'
import type { UnifiedMediaItemData, MediaType } from '@/core/mediaitem/types'
import type { VideoResolution } from '@/core/types'

// ==================== 新架构工具导入 ====================
import { TimelineItemFactory } from '@/core/timelineitem'
import { MediaSync } from '@/core/managers/sync'
import { TimelineItemQueries } from '@/core/timelineitem/queries'

/**
 * 移除时间轴项目命令
 * 支持移除已知和未知时间轴项目的撤销/重做操作
 * 遵循"从源头重建"原则：保存完整的重建元数据，撤销时从原始素材重新创建
 */
export class RemoveTimelineItemCommand implements SimpleCommand {
  public readonly id: string
  public readonly description: string
  private originalTimelineItemData: UnifiedTimelineItemData<MediaType> | null = null // 保存原始项目的重建数据
  private _isDisposed = false
  private mediaSync?: MediaSync // 持有MediaSync引用

  constructor(
    private timelineItemId: string,
    private timelineModule: {
      addTimelineItem: (item: UnifiedTimelineItemData<MediaType>) => Promise<void>
      removeTimelineItem: (id: string) => Promise<void>
      getTimelineItem: (id: string) => UnifiedTimelineItemData<MediaType> | undefined
    },
    private mediaModule: {
      getMediaItem: (id: string | null) => UnifiedMediaItemData | undefined
    },
    private configModule: {
      videoResolution: Ref<VideoResolution>
    },
  ) {
    this.id = generateCommandId()

    this.description = `移除时间轴项目: ${timelineItemId}`
  }

  /**
   * 执行命令：删除时间轴项目
   */
  async execute(): Promise<void> {
    try {
      // 检查项目是否存在
      const existingItem = this.timelineModule.getTimelineItem(this.timelineItemId)
      if (!existingItem) {
        console.warn(`⚠️ 时间轴项目不存在，无法删除: ${this.timelineItemId}`)
        return
      }

      if (!this.originalTimelineItemData) {
        // 保存重建所需的完整元数据
        this.originalTimelineItemData = TimelineItemFactory.clone(existingItem)
      }

      // 设置媒体同步（只针对loading状态的项目）
      // 注意：即使项目即将被删除，仍需要同步以更新命令数据（用于撤销）
      if (TimelineItemQueries.isLoading(existingItem)) {
        // 先清理旧的MediaSync实例（防止重复执行时创建多个同步）
        if (this.mediaSync) {
          this.mediaSync.cleanup()
          this.mediaSync = undefined
        }

        // 确保 mediaItemId 不为 null
        if (existingItem.mediaItemId === null) {
          throw new Error('mediaItemId 不能为 null')
        }

        this.mediaSync = new MediaSync(existingItem.mediaItemId, {
          syncId: this.id, // 使用命令ID作为syncId
          timelineItemIds: [existingItem.id], // 保存时间轴项目ID
          shouldUpdateCommand: !existingItem.runtime.isInitialized, // 需要更新命令数据（撤销用）
          commandId: this.id,
          description: `RemoveTimelineItemCommand: ${this.id}`,
        })
        await this.mediaSync.setup()
      }

      // 删除时间轴项目（这会自动处理相关资源的清理）
      await this.timelineModule.removeTimelineItem(this.timelineItemId)
      console.log(`↩️ 已删除时间轴项目: ${this.timelineItemId}`)
    } catch (error) {
      console.error(`❌ 删除时间轴项目失败: ${this.timelineItemId}`, error)
      throw error
    }
  }

  /**
   * 撤销命令：重新创建时间轴项目
   * 遵循"从源头重建"原则，从原始素材完全重新创建
   */
  async undo(): Promise<void> {
    if (!this.originalTimelineItemData) {
      throw new Error('没有有效的时间轴项目数据')
    }
    try {
      console.log(`🔄 执行撤销删除操作：从源头重建时间轴项目...`)

      // 从原始素材重新创建TimelineItem和sprite
      const rebuildResult = await TimelineItemFactory.rebuildForCmd({
        originalTimelineItemData: this.originalTimelineItemData,
        getMediaItem: this.mediaModule.getMediaItem,
        logIdentifier: 'RemoveTimelineItemCommand undo',
      })

      if (!rebuildResult.success) {
        throw new Error(`重建时间轴项目失败: ${rebuildResult.error}`)
      }

      const newTimelineItem = rebuildResult.timelineItem

      // 1. 添加到时间轴
      await this.timelineModule.addTimelineItem(newTimelineItem)

      // 2. 针对loading状态的项目设置状态同步
      if (TimelineItemQueries.isLoading(newTimelineItem)) {
        // 先清理旧的MediaSync实例（防止重复执行时创建多个同步）
        if (this.mediaSync) {
          this.mediaSync.cleanup()
          this.mediaSync = undefined
        }

        // 确保 mediaItemId 不为 null
        if (newTimelineItem.mediaItemId === null) {
          throw new Error('mediaItemId 不能为 null')
        }

        // 🔧 关键：根据 isInitialized 决定是否需要更新命令数据
        // - 如果已初始化：命令中已有完整数据，不需要更新命令（shouldUpdateCommand = false）
        // - 如果未初始化：需要等待媒体就绪后更新命令数据（shouldUpdateCommand = true）

        this.mediaSync = new MediaSync(newTimelineItem.mediaItemId, {
          syncId: this.id,
          timelineItemIds: [newTimelineItem.id],
          shouldUpdateCommand: !newTimelineItem.runtime.isInitialized,
          commandId: this.id,
          description: `RemoveTimelineItemCommand undo: ${this.id}`,
        })
        await this.mediaSync.setup()
      }
      console.log(`✅ 已撤销删除时间轴项目: ${this.originalTimelineItemData.id}`)
    } catch (error) {
      console.error(`❌ 撤销删除时间轴项目失败: ${this.originalTimelineItemData.id}`, error)
      throw error
    }
  }

  /**
   * 更新媒体数据（由媒体同步调用）
   * @param mediaData 最新的媒体数据
   */
  updateMediaData(mediaData: UnifiedMediaItemData, timelineItemId?: string): void {
    if (this.originalTimelineItemData) {
      // 从 bunny 对象中获取原始尺寸信息
      if (
        TimelineItemQueries.hasVisualProperties(this.originalTimelineItemData) &&
        mediaData.runtime.bunny?.originalWidth !== undefined &&
        mediaData.runtime.bunny?.originalHeight !== undefined
      ) {
        this.originalTimelineItemData.config.width = mediaData.runtime.bunny.originalWidth
        this.originalTimelineItemData.config.height = mediaData.runtime.bunny.originalHeight
      }

      if (mediaData.duration !== undefined) {
        // 更新timeRange的持续时间，而不是config.duration
        const startTime = this.originalTimelineItemData.timeRange.timelineStartTime
        const clipStartTime = this.originalTimelineItemData.timeRange.clipStartTime
        this.originalTimelineItemData.timeRange = {
          timelineStartTime: startTime,
          timelineEndTime: startTime + mediaData.duration,
          clipStartTime: clipStartTime,
          clipEndTime: clipStartTime + mediaData.duration,
        }
      }
      this.originalTimelineItemData.timelineStatus = 'ready'

      console.log(`🔄 [RemoveTimelineItemCommand] 已更新媒体数据: ${this.id}`, {
        width:
          TimelineItemQueries.hasVisualProperties(this.originalTimelineItemData)
            ? this.originalTimelineItemData.config.width
            : undefined,
        height:
          TimelineItemQueries.hasVisualProperties(this.originalTimelineItemData)
            ? this.originalTimelineItemData.config.height
            : undefined,
        duration: mediaData.duration,
      })
    }
  }

  /**
   * 检查命令是否已被清理
   */
  get isDisposed(): boolean {
    return this._isDisposed
  }

  /**
   * 清理命令持有的资源
   */
  dispose(): void {
    if (this._isDisposed) {
      return
    }

    this._isDisposed = true
    // 清理MediaSync
    if (this.mediaSync) {
      this.mediaSync.cleanup()
      this.mediaSync = undefined
    }
    console.log(`🗑️ [RemoveTimelineItemCommand] 命令资源已清理: ${this.id}`)
  }
}
