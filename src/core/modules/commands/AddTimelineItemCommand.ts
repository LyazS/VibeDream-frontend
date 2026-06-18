/**
 * 添加时间轴项目命令
 * 支持添加已知和未知时间轴项目的撤销/重做操作
 * 采用统一重建逻辑：每次执行都从原始素材重新创建sprite（已知项目）或重建占位符（未知项目）
 */

import type { SimpleCommand } from '@/core/modules/commands/types'
import type { UnifiedTimelineItemData } from '@/core/timelineitem/model/timelineItem'
import type { UnifiedMediaItemData, MediaType } from '@/core/mediaitem/types'

// ==================== 新架构工具导入 ====================
import { TimelineItemFactory } from '@/core/timelineitem/runtime/factory'
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
    private ensureTimelineItemResolved: (timelineItemId: string) => Promise<unknown>,
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

      const rebuildResult = await TimelineItemFactory.buildForDag({
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

      // 2. 恢复后的项目统一交给 timeline item DAG dispatcher 推进
      if (TimelineItemQueries.isLoading(newTimelineItem) || newTimelineItem.isPlaceholder) {
        console.log('🔗 [AddTimelineItemCommand] trigger timeline item resolve', {
          timelineItemId: newTimelineItem.id,
          mediaItemId: newTimelineItem.mediaItemId,
          isPlaceholder: newTimelineItem.isPlaceholder,
          isInitialized: newTimelineItem.runtime.isInitialized,
          timelineStatus: newTimelineItem.timelineStatus,
        })
        void this.ensureTimelineItemResolved(newTimelineItem.id).catch((error) => {
          console.error(`❌ timeline item resolve 启动失败: ${newTimelineItem.id}`, error)
        })
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

      // 移除时间轴项目（这会自动处理 sprite 的清理）
      await this.timelineModule.removeTimelineItem(this.originalTimelineItemData.id)
      console.log(`↩️ 已撤销添加时间轴项目: ${this.originalTimelineItemData.id}`)
    } catch (error) {
      console.error(`❌ 撤销添加时间轴项目失败: ${this.originalTimelineItemData.id}`, error)
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
    console.log(`🗑️ [AddTimelineItemCommand] 命令资源已清理: ${this.id}`)
  }
}
