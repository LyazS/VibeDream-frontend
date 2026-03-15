/**
 * 添加时间轴项目命令
 * 支持添加已知和未知时间轴项目的撤销/重做操作
 * 采用统一重建逻辑：每次执行都从原始素材重新创建sprite（已知项目）或重建占位符（未知项目）
 */

import type { Ref } from 'vue'
// ==================== 新架构类型导入 ====================
import type { SimpleCommand } from '@/core/modules/commands/types'
import type { UnifiedTimelineItemData } from '@/core/timelineitem/type'
import type { UnifiedMediaItemData, MediaType } from '@/core/mediaitem/types'
import type { VideoResolution } from '@/core/types'

// ==================== 新架构工具导入 ====================
import { MediaSync } from '@/core/managers/sync'
import { TimelineItemFactory } from '@/core/timelineitem'
import { TimelineItemQueries } from '@/core/timelineitem/queries'
// ==================== 旧架构类型工具导入 ====================
import { generateCommandId } from '@/core/utils/idGenerator'

/**
 * 添加时间轴项目命令
 * 支持添加已知和未知时间轴项目的撤销/重做操作
 * 采用统一重建逻辑：每次执行都从原始素材重新创建sprite（已知项目）或重建占位符（未知项目）
 */
export class AddTimelineItemCommand implements SimpleCommand {
  public readonly id: string
  public readonly description: string
  private originalTimelineItemData: UnifiedTimelineItemData<MediaType> | null = null // 保存原始项目的重建数据
  private _isDisposed = false
  private mediaSync?: MediaSync // 持有MediaSync引用

  constructor(
    timelineItem: UnifiedTimelineItemData<MediaType>,
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

    // 新架构只支持已知媒体类型
    this.description = `添加时间轴项目: ${timelineItem.id}`

    // 保存原始数据用于重建sprite
    this.originalTimelineItemData = TimelineItemFactory.clone(timelineItem)
  }

  /**
   * 执行命令：添加时间轴项目
   * 统一重建逻辑：每次执行都从原始素材重新创建（已知项目）或重建占位符（未知项目）
   */
  async execute(): Promise<void> {
    if (!this.originalTimelineItemData) {
      throw new Error('没有有效的时间轴项目数据')
    }
    try {
      console.log(`🔄 执行添加操作：从源头重建时间轴项目...`)

      const rebuildResult = await TimelineItemFactory.rebuildForCmd({
        originalTimelineItemData: this.originalTimelineItemData,
        getMediaItem: this.mediaModule.getMediaItem,
        logIdentifier: 'AddTimelineItemCommand execute',
      })

      if (!rebuildResult.success) {
        throw new Error(`重建时间轴项目失败: ${rebuildResult.error}`)
      }

      const newTimelineItem = rebuildResult.timelineItem

      // 1. 添加到时间轴
      await this.timelineModule.addTimelineItem(newTimelineItem)

      // 2. 针对loading状态的项目设置状态同步（确保时间轴项目已添加到store）
      if (TimelineItemQueries.isLoading(newTimelineItem)) {
        // 先清理旧的MediaSync实例（防止重复执行时创建多个同步）
        if (this.mediaSync) {
          this.mediaSync.cleanup()
          this.mediaSync = undefined
        }

        // 确保 mediaItemId 不为 null（文本类型不会走到这里，因为文本类型不会是 loading 状态）
        if (newTimelineItem.mediaItemId === null) {
          throw new Error('mediaItemId 不能为 null')
        }

        this.mediaSync = new MediaSync(newTimelineItem.mediaItemId, {
          syncId: this.id, // 使用命令ID作为syncId
          timelineItemIds: [newTimelineItem.id], // 单个时间轴项目
          shouldUpdateCommand: !newTimelineItem.runtime.isInitialized, // 需要更新命令数据
          commandId: this.id,
          description: `AddTimelineItemCommand: ${this.id}`,
        })
        await this.mediaSync.setup()
      }
      console.log(`✅ 已添加时间轴项目: ${this.originalTimelineItemData.id}`)
    } catch (error) {
      console.error(`❌ 添加时间轴项目失败: ${this.originalTimelineItemData.id}`, error)
      throw error
    }
  }

  /**
   * 撤销命令：移除时间轴项目
   */
  async undo(): Promise<void> {
    if (!this.originalTimelineItemData) {
      console.warn('⚠️ 没有有效的时间轴项目数据，无法撤销')
      return
    }
    try {
      const existingItem = this.timelineModule.getTimelineItem(this.originalTimelineItemData.id)
      if (!existingItem) {
        console.warn(`⚠️ 时间轴项目不存在，无法撤销: ${this.originalTimelineItemData.id}`)
        return
      }

      // 移除时间轴项目（这会自动处理sprite的清理）
      // 注意：undo时不需要设置MediaSync，因为是删除操作
      await this.timelineModule.removeTimelineItem(this.originalTimelineItemData.id)
      console.log(`↩️ 已撤销添加时间轴项目: ${this.originalTimelineItemData.id}`)
    } catch (error) {
      console.error(`❌ 撤销添加时间轴项目失败: ${this.originalTimelineItemData.id}`, error)
      throw error
    }
  }

  /**
   * 更新媒体数据（由媒体同步调用）
   * @param mediaData 最新的媒体数据
   */
  updateMediaData(mediaData: UnifiedMediaItemData): void {
    if (this.originalTimelineItemData) {
      const config = this.originalTimelineItemData.config as any

      // 从 bunny 对象中获取原始尺寸信息
      if (
        mediaData.runtime.bunny?.originalWidth !== undefined &&
        mediaData.runtime.bunny?.originalHeight !== undefined
      ) {
        config.width = mediaData.runtime.bunny.originalWidth
        config.height = mediaData.runtime.bunny.originalHeight
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

      console.log(`🔄 [AddTimelineItemCommand] 已更新媒体数据: ${this.id}`, {
        width: config.width,
        height: config.height,
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
    console.log(`🗑️ [AddTimelineItemCommand] 命令资源已清理: ${this.id}`)
  }
}
