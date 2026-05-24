/**
 * 移除时间轴项目命令
 * 支持移除已知和未知时间轴项目的撤销/重做操作
 * 遵循"从源头重建"原则：保存完整的重建元数据，撤销时从原始素材重新创建
 */
import { generateCommandId } from '@/core/utils/idGenerator'
import type { SimpleCommand } from '@/core/modules/commands/types'

// ==================== 新架构类型导入 ====================
import type { UnifiedTimelineItemData } from '@/core/timelineitem/type'
import type { UnifiedMediaItemData, MediaType } from '@/core/mediaitem/types'

// ==================== 新架构工具导入 ====================
import { TimelineItemFactory } from '@/core/timelineitem'
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
    private ensureTimelineItemReady: (timelineItemId: string) => Promise<unknown>,
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

      const rebuildResult = await TimelineItemFactory.buildForReadyDag({
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

      // 2. loading 项目交给 timeline-item-ready DAG 推进
      if (TimelineItemQueries.isLoading(newTimelineItem)) {
        console.log('🔗 [RemoveTimelineItemCommand] trigger timeline-item-ready', {
          timelineItemId: newTimelineItem.id,
          mediaItemId: newTimelineItem.mediaItemId,
          isInitialized: newTimelineItem.runtime.isInitialized,
          timelineStatus: newTimelineItem.timelineStatus,
        })
        void this.ensureTimelineItemReady(newTimelineItem.id).catch((error) => {
          console.error(`❌ timeline-item-ready 启动失败: ${newTimelineItem.id}`, error)
        })
      }
      console.log(`✅ 已撤销删除时间轴项目: ${this.originalTimelineItemData.id}`)
    } catch (error) {
      console.error(`❌ 撤销删除时间轴项目失败: ${this.originalTimelineItemData.id}`, error)
      throw error
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
    console.log(`🗑️ [RemoveTimelineItemCommand] 命令资源已清理: ${this.id}`)
  }
}
