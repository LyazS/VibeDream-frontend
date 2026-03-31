/**
 * 删除关键帧命令
 * 支持删除指定帧位置的关键帧
 * 适配新架构的统一类型系统
 */

import type { SimpleCommand } from '@/core/modules/commands/types'
import {
  type KeyframeSnapshot,
  type TimelineModule,
  type PlaybackControls,
  createSnapshot,
  applyKeyframeSnapshot,
  isPlayheadInTimelineItem,
  showUserWarning,
} from './shared'
import { generateCommandId } from '@/core/utils/idGenerator'
import { removeKeyframeAtFrame, disableAnimation } from '@/core/utils/unifiedKeyframeUtils'
import type { AnimationChannelKey } from '@/core/timelineitem/bunnytype'

export class DeleteKeyframeCommand implements SimpleCommand {
  public readonly id: string
  public readonly description: string
  private beforeSnapshot: KeyframeSnapshot
  private afterSnapshot: KeyframeSnapshot | null = null
  private _isDisposed = false

  constructor(
    private timelineItemId: string,
    private frame: number,
    private channel: AnimationChannelKey,
    private timelineModule: TimelineModule,
    private playbackControls?: PlaybackControls,
  ) {
    this.id = generateCommandId()
    this.description = `删除关键帧 (帧 ${frame})`

    // 保存执行前的状态快照
    const item = this.timelineModule.getTimelineItem(timelineItemId)
    if (!item) {
      throw new Error(`时间轴项目不存在: ${timelineItemId}`)
    }
    this.beforeSnapshot = createSnapshot(item)
  }

  /**
   * 执行命令：删除关键帧
   */
  async execute(): Promise<void> {
    const item = this.timelineModule.getTimelineItem(this.timelineItemId)
    if (!item) {
      throw new Error(`时间轴项目不存在: ${this.timelineItemId}`)
    }

    // 检查播放头是否在clip时间范围内
    if (!isPlayheadInTimelineItem(item, this.frame)) {
      await showUserWarning(
        '无法删除关键帧',
        '播放头不在当前视频片段的时间范围内。请将播放头移动到片段内再尝试删除关键帧。',
      )

      console.warn('🎬 [Delete Keyframe Command] 播放头不在当前clip时间范围内，无法删除关键帧:', {
        itemId: this.timelineItemId,
        frame: this.frame,
        clipTimeRange: {
          start: item.timeRange.timelineStartTime,
          end: item.timeRange.timelineEndTime,
        },
      })
      throw new Error('播放头不在当前clip时间范围内，无法删除关键帧')
    }

    try {
      // 1. 删除指定帧的关键帧
      removeKeyframeAtFrame(item, this.frame, this.channel)

      if (!item.animation?.groups || Object.keys(item.animation.groups).length === 0) {
        disableAnimation(item)
      }

      // 3. 动画更新已迁移到 Bunny 组件，无需手动更新

      // 4. 保存执行后的状态快照
      this.afterSnapshot = createSnapshot(item)

      // 5. 重做关键帧操作时，跳转到相关帧位置
      if (this.playbackControls) {
        this.playbackControls.seekTo(this.frame)
      }

      console.log('✅ 删除关键帧命令执行成功:', {
        itemId: this.timelineItemId,
        frame: this.frame,
        channel: this.channel,
      })
    } catch (error) {
      console.error('❌ 删除关键帧命令执行失败:', error)
      throw error
    }
  }

  /**
   * 撤销命令：恢复到删除前的状态
   */
  async undo(): Promise<void> {
    const item = this.timelineModule.getTimelineItem(this.timelineItemId)
    if (!item) {
      throw new Error(`时间轴项目不存在: ${this.timelineItemId}`)
    }

    try {
      await applyKeyframeSnapshot(item, this.beforeSnapshot)

      // 撤销关键帧操作时，跳转到相关帧位置（seekTo会自动触发渲染更新）
      if (this.playbackControls) {
        this.playbackControls.seekTo(this.frame)
      }

      console.log('↩️ 删除关键帧命令撤销成功:', {
        itemId: this.timelineItemId,
        frame: this.frame,
        channel: this.channel,
      })
    } catch (error) {
      console.error('❌ 删除关键帧命令撤销失败:', error)
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
    console.log(`🗑️ [DeleteKeyframeCommand] 命令资源已清理: ${this.id}`)
  }
}
