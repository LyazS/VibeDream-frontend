import type { AnimationChannelKey } from '@/core/timelineitem/bunnytype'
import type { SimpleCommand } from '@/core/modules/commands/types'
import {
  type KeyframeSnapshot,
  type PlaybackControls,
  type TimelineModule,
  applyKeyframeSnapshot,
  createSnapshot,
  isPlayheadInTimelineItem,
  showUserWarning,
} from './shared'
import { generateCommandId } from '@/core/utils/idGenerator'
import { toggleGroupKeyframe } from '@/core/animation/engine'

export class ToggleAnimationGroupKeyframeCommand implements SimpleCommand {
  public readonly id: string
  public readonly description: string
  private beforeSnapshot: KeyframeSnapshot
  private _isDisposed = false

  constructor(
    private timelineItemId: string,
    private frame: number,
    private groupId: AnimationChannelKey,
    private timelineModule: TimelineModule,
    private playbackControls?: PlaybackControls,
  ) {
    this.id = generateCommandId()
    this.description = `切换动画组关键帧: ${groupId}`
    const item = this.timelineModule.getTimelineItem(timelineItemId)
    if (!item) {
      throw new Error(`时间轴项目不存在: ${timelineItemId}`)
    }
    this.beforeSnapshot = createSnapshot(item)
  }

  async execute(): Promise<void> {
    const item = this.timelineModule.getTimelineItem(this.timelineItemId)
    if (!item) {
      throw new Error(`时间轴项目不存在: ${this.timelineItemId}`)
    }
    if (!isPlayheadInTimelineItem(item, this.frame)) {
      await showUserWarning('无法切换关键帧', '播放头不在当前片段内。')
      throw new Error('播放头不在当前clip时间范围内，无法切换关键帧')
    }
    toggleGroupKeyframe(item, this.frame, this.groupId)
    this.playbackControls?.seekTo(this.frame)
  }

  async undo(): Promise<void> {
    const item = this.timelineModule.getTimelineItem(this.timelineItemId)
    if (!item) {
      throw new Error(`时间轴项目不存在: ${this.timelineItemId}`)
    }
    await applyKeyframeSnapshot(item, this.beforeSnapshot)
    this.playbackControls?.seekTo(this.frame)
  }

  get isDisposed(): boolean {
    return this._isDisposed
  }

  dispose(): void {
    this._isDisposed = true
  }
}
