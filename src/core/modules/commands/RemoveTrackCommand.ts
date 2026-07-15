import type { Ref } from 'vue'
import { generateCommandId } from '@/core/utils/idGenerator'
import type { SimpleCommand } from '@/core/modules/commands/types'

// 类型导入
import type { UnifiedTimelineItemData } from '@/core/timelineitem/model/timelineItem'
import type { UnifiedMediaItemData, MediaType } from '@/core/mediaitem/types'
import type { UnifiedTrackData, UnifiedTrackType } from '@/core/track/TrackTypes'
import { TimelineItemFactory } from '@/core/timelineitem/runtime/factory'
import { TimelineItemQueries } from '@/core/timelineitem/queries'

/**
 * 删除轨道命令
 * 支持删除轨道的撤销/重做操作，兼容已知和未知时间轴项目
 * 遵循"从源头重建"原则：保存轨道信息和所有受影响的时间轴项目信息，撤销时完全重建
 */
export class RemoveTrackCommand implements SimpleCommand {
  public readonly id: string
  public readonly description: string
  private trackData: UnifiedTrackData // 保存被删除的轨道数据
  private trackIndex: number // 保存被删除的轨道在tracks数组中的原始索引位置
  private affectedTimelineItems: UnifiedTimelineItemData<MediaType>[] = [] // 保存被删除的时间轴项目的重建元数据
  private _isDisposed = false

  constructor(
    private trackId: string,
    private trackModule: {
      addTrack: (trackData: UnifiedTrackData, position?: number) => UnifiedTrackData
      removeTrack: (trackId: string) => Promise<void>
      getTrack: (trackId: string) => UnifiedTrackData | undefined
      tracks: { value: UnifiedTrackData[] }
    },
    private timelineModule: {
      addTimelineItem: (item: UnifiedTimelineItemData<MediaType>) => Promise<void>
      removeTimelineItem: (id: string) => void
      getTimelineItem: (id: string) => UnifiedTimelineItemData<MediaType> | undefined
      timelineItems: Ref<UnifiedTimelineItemData<MediaType>[]>
    },
    private mediaModule: {
      getMediaItem: (id: string | null) => UnifiedMediaItemData | undefined
    },
    private ensureTimelineItemResolved: (timelineItemId: string) => Promise<unknown>,
  ) {
    this.id = generateCommandId()

    // 获取要删除的轨道信息
    const track = this.trackModule.getTrack(trackId)
    if (!track) {
      throw new Error(`找不到要删除的轨道: ${trackId}`)
    }

    // 保存轨道在tracks数组中的原始索引位置
    this.trackIndex = this.trackModule.tracks.value.findIndex((t) => t.id === trackId)
    if (this.trackIndex === -1) {
      throw new Error(`找不到轨道在tracks数组中的索引: ${trackId}`)
    }

    this.trackData = { ...track }
    this.description = `删除轨道: ${track.name}`

    // 保存该轨道上所有时间轴项目的重建元数据
    const affectedItems = this.timelineModule.timelineItems.value.filter(
      (item) => item.trackId === trackId,
    )

    // 保存所有受影响的时间轴项目（新架构只支持已知类型）
    for (const item of affectedItems) {
      this.affectedTimelineItems.push(TimelineItemFactory.clone(item))
    }

    console.log(
      `📋 准备删除轨道: ${track.name}, 受影响的项目: ${this.affectedTimelineItems.length}个`,
    )
  }

  /**
   * 执行命令：删除轨道及其上的所有时间轴项目
   */
  async execute(): Promise<void> {
    try {
      console.log(`🔄 执行删除轨道操作: ${this.trackData.name}...`)

      // 检查是否为最后一个轨道
      if (this.trackModule.tracks.value.length <= 1) {
        throw new Error('不能删除最后一个轨道')
      }

      // 检查轨道是否存在
      const track = this.trackModule.getTrack(this.trackId)
      if (!track) {
        console.warn(`⚠️ 轨道不存在，无法删除: ${this.trackId}`)
        return
      }

      // 删除轨道（这会自动删除轨道上的所有时间轴项目）
      await this.trackModule.removeTrack(this.trackId)

      console.log(
        `✅ 已删除轨道: ${this.trackData.name}, 删除了 ${this.affectedTimelineItems.length} 个时间轴项目`,
      )
    } catch (error) {
      console.error(`❌ 删除轨道失败: ${this.trackData.name}`, error)
      throw error
    }
  }

  /**
   * 撤销命令：重建轨道和所有受影响的时间轴项目
   * 遵循"从源头重建"原则，从原始素材完全重新创建所有项目
   */
  async undo(): Promise<void> {
    try {
      console.log(`🔄 撤销删除轨道操作：重建轨道 ${this.trackData.name}...`)

      // 1. 重建轨道，使用保存的原始索引位置
      this.trackModule.addTrack({ ...this.trackData }, this.trackIndex)

      // 2. 重建所有受影响的时间轴项目
      const newTimelineItems: UnifiedTimelineItemData<MediaType>[] = []

      for (const itemData of this.affectedTimelineItems) {
        console.log(`🔄 执行撤销删除轨道操作：从源头重建时间轴项目...`)

        const rebuildResult = await TimelineItemFactory.buildForDag({
          originalTimelineItemData: itemData,
          getMediaItem: this.mediaModule.getMediaItem,
          logIdentifier: 'RemoveTrackCommand undo',
        })

        if (!rebuildResult.success) {
          throw new Error(`轨道删除撤销重建时间轴项目失败: ${rebuildResult.error}`)
        }

        const newTimelineItem = rebuildResult.timelineItem

        // 添加到时间轴
        await this.timelineModule.addTimelineItem(newTimelineItem)

        // 收集新创建的时间轴项目
        newTimelineItems.push(newTimelineItem)

        console.log(`✅ 轨道删除撤销已恢复时间轴项目: ${itemData.id}`)
      }

      for (const item of newTimelineItems) {
        if (TimelineItemQueries.isLoading(item) || item.isPlaceholder) {
          console.log('🔗 [RemoveTrackCommand] trigger timeline item resolve', {
            timelineItemId: item.id,
            mediaItemId: item.mediaItemId,
            isPlaceholder: item.isPlaceholder,
            isInitialized: item.runtime.isInitialized,
            timelineStatus: item.timelineStatus,
          })
          void this.ensureTimelineItemResolved(item.id).catch((error) => {
            console.error(`❌ timeline item resolve 启动失败: ${item.id}`, error)
          })
        }
      }

      console.log(
        `↩️ 已撤销删除轨道: ${this.trackData.name}, 恢复了 ${this.affectedTimelineItems.length} 个时间轴项目`,
      )
    } catch (error) {
      console.error(`❌ 撤销删除轨道失败: ${this.trackData.name}`, error)
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
    console.log(`🗑️ [RemoveTrackCommand] 命令资源已清理: ${this.id}`)
  }
}
