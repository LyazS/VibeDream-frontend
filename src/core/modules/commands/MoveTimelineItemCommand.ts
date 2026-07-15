/**
 * 移动时间轴项目命令
 * 支持已知和未知时间轴项目位置移动的撤销/重做操作
 * 包括时间位置移动和轨道间移动
 */

import { generateCommandId } from '@/core/utils/idGenerator'
import type { SimpleCommand } from '@/core/modules/commands/types'

// ==================== 新架构类型导入 ====================
import type { UnifiedTimelineItemData } from '@/core/timelineitem/model/timelineItem'

import type { UnifiedMediaItemData, MediaType } from '@/core/mediaitem/types'

/**
 * 移动时间轴项目命令
 * 支持已知和未知时间轴项目位置移动的撤销/重做操作
 * 包括时间位置移动和轨道间移动
 */
export class MoveTimelineItemCommand implements SimpleCommand {
  public readonly id: string
  public readonly description: string
  private _isDisposed = false

  constructor(
    private timelineItemId: string,
    private oldPositionFrames: number, // 旧的时间位置（帧数）
    private newPositionFrames: number, // 新的时间位置（帧数）
    private oldTrackId: string, // 旧的轨道ID
    private newTrackId: string, // 新的轨道ID
    private timelineModule: {
      updateTimelineItemPosition: (id: string, positionFrames: number, trackId?: string) => void
      getTimelineItem: (id: string) => UnifiedTimelineItemData<MediaType> | undefined
    },
    private mediaModule: {
      getMediaItem: (id: string | null) => UnifiedMediaItemData | undefined
    },
  ) {
    this.id = generateCommandId()

    const timelineItem = this.timelineModule.getTimelineItem(timelineItemId)
    let itemName = '未知素材'

    // 根据项目类型获取名称
    if (timelineItem) {
      const mediaItem = this.mediaModule.getMediaItem(timelineItem.mediaItemId)
      itemName = mediaItem?.name || '未知素材'
    }

    // 生成描述信息
    const positionChanged = this.oldPositionFrames !== this.newPositionFrames
    const trackChanged = oldTrackId !== newTrackId

    if (positionChanged && trackChanged) {
      this.description = `移动时间轴项目: ${itemName} (位置: ${this.oldPositionFrames}帧→${this.newPositionFrames}帧, 轨道: ${oldTrackId}→${newTrackId})`
    } else if (positionChanged) {
      this.description = `移动时间轴项目: ${itemName} (位置: ${this.oldPositionFrames}帧→${this.newPositionFrames}帧)`
    } else if (trackChanged) {
      this.description = `移动时间轴项目: ${itemName} (轨道: ${oldTrackId}→${newTrackId})`
    } else {
      this.description = `移动时间轴项目: ${itemName} (无变化)`
    }

    console.log('💾 保存移动操作数据:', {
      timelineItemId,
      oldPositionFrames: this.oldPositionFrames,
      newPositionFrames: this.newPositionFrames,
      oldTrackId,
      newTrackId,
      positionChanged,
      trackChanged,
    })
  }

  /**
   * 执行命令：移动时间轴项目到新位置
   */
  async execute(): Promise<void> {
    try {
      // 检查项目是否存在
      const timelineItem = this.timelineModule.getTimelineItem(this.timelineItemId)
      if (!timelineItem) {
        console.warn(`⚠️ 时间轴项目不存在，无法移动: ${this.timelineItemId}`)
        return
      }

      // 移动到新位置
      const trackIdToSet = this.oldTrackId !== this.newTrackId ? this.newTrackId : undefined
      this.timelineModule.updateTimelineItemPosition(
        this.timelineItemId,
        this.newPositionFrames,
        trackIdToSet,
      )

      // 根据项目类型获取名称
      const mediaItem = this.mediaModule.getMediaItem(timelineItem.mediaItemId)
      const itemName = mediaItem?.name || '未知素材'

      console.log(
        `🔄 已移动时间轴项目: ${itemName} 到位置 ${this.newPositionFrames}帧, 轨道 ${this.newTrackId}`,
      )
    } catch (error) {
      const timelineItem = this.timelineModule.getTimelineItem(this.timelineItemId)
      const mediaItem = timelineItem
        ? this.mediaModule.getMediaItem(timelineItem.mediaItemId)
        : null
      const itemName = mediaItem?.name || '未知素材'
      console.error(`❌ 移动时间轴项目失败: ${itemName}`, error)
      throw error
    }
  }

  /**
   * 撤销命令：移动时间轴项目回到原位置
   */
  async undo(): Promise<void> {
    try {
      // 检查项目是否存在
      const timelineItem = this.timelineModule.getTimelineItem(this.timelineItemId)
      if (!timelineItem) {
        console.warn(`⚠️ 时间轴项目不存在，无法撤销移动: ${this.timelineItemId}`)
        return
      }

      // 移动回原位置
      const trackIdToSet = this.oldTrackId !== this.newTrackId ? this.oldTrackId : undefined
      this.timelineModule.updateTimelineItemPosition(
        this.timelineItemId,
        this.oldPositionFrames,
        trackIdToSet,
      )

      // 根据项目类型获取名称
      const mediaItem = this.mediaModule.getMediaItem(timelineItem.mediaItemId)
      const itemName = mediaItem?.name || '未知素材'

      console.log(
        `↩️ 已撤销移动时间轴项目: ${itemName} 回到位置 ${this.oldPositionFrames}帧, 轨道 ${this.oldTrackId}`,
      )
    } catch (error) {
      const timelineItem = this.timelineModule.getTimelineItem(this.timelineItemId)
      const mediaItem = timelineItem
        ? this.mediaModule.getMediaItem(timelineItem.mediaItemId)
        : null
      const itemName = mediaItem?.name || '未知素材'
      console.error(`❌ 撤销移动时间轴项目失败: ${itemName}`, error)
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
    console.log(`🗑️ [MoveTimelineItemCommand] 命令资源已清理: ${this.id}`)
  }
}
