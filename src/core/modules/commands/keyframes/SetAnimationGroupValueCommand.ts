import type { MediaType } from '@/core/mediaitem'
import type { SimpleCommand } from '@/core/modules/commands/types'
import type {
  AnimationGroupId,
  AnimationGroupValueMap,
} from '@/core/timelineitem/bunnytype'
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
import { setGroupValue } from '@/core/animation/engine'

export class SetAnimationGroupValueCommand<G extends AnimationGroupId = AnimationGroupId>
implements SimpleCommand {
  public readonly id: string
  public readonly description: string
  private beforeSnapshot: KeyframeSnapshot
  private _isDisposed = false

  constructor(
    private timelineItemId: string,
    private frame: number,
    private groupId: G,
    private patch: Partial<AnimationGroupValueMap[G]>,
    private timelineModule: TimelineModule,
    private playbackControls?: PlaybackControls,
  ) {
    this.id = generateCommandId()
    this.description = `修改动画组: ${groupId}`

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
      await showUserWarning('无法更新动画', '播放头不在当前片段内。')
      throw new Error('播放头不在当前clip时间范围内，无法更新动画组')
    }
    setGroupValue(item, this.frame, this.groupId, this.patch as never)
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
