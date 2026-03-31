import type { SimpleCommand } from '@/core/modules/commands/types'
import type { MediaType } from '@/core/mediaitem'
import type { MaskConfigPatch, MaskPropertyPath, MaskType } from '@/core/timelineitem/mask'
import { getItemLocalSize, normalizeMaskConfig, replaceMaskType } from '@/core/timelineitem/mask'
import { generateCommandId } from '@/core/utils/idGenerator'
import { handlePropertyChange } from '@/core/utils/unifiedKeyframeUtils'
import { TimelineItemQueries } from '@/core/timelineitem/queries'
import type { UnifiedMediaModule } from '@/core/modules'
import type { UnifiedTimelineItemData } from '@/core/timelineitem/type'
import {
  type KeyframeSnapshot,
  type TimelineModule,
  type PlaybackControls,
  createSnapshot,
  applyKeyframeSnapshot,
  isPlayheadInTimelineItem,
  showUserWarning,
} from './shared'

export type MaskUpdateAction =
  | { type: 'set-property'; path: MaskPropertyPath; value: number }
  | { type: 'set-enabled'; value: boolean }
  | { type: 'set-type'; value: MaskType }
  | { type: 'set-inverted'; value: boolean }
  | { type: 'replace-config'; value: MaskConfigPatch }

export class UpdateMaskCommand implements SimpleCommand {
  public readonly id: string
  public readonly description: string
  private beforeSnapshot: KeyframeSnapshot
  private afterSnapshot: KeyframeSnapshot | null = null
  private _isDisposed = false

  constructor(
    private timelineItemId: string,
    private frame: number,
    private action: MaskUpdateAction,
    private timelineModule: TimelineModule,
    private _mediaModule: Pick<UnifiedMediaModule, 'getMediaItem'>,
    private playbackControls?: PlaybackControls,
  ) {
    this.id = generateCommandId()
    this.description = `修改蒙版 (${action.type})`

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

    if (!TimelineItemQueries.hasVisualProperties(item)) {
      throw new Error('当前时间轴项目不支持蒙版')
    }

    if (this.action.type === 'set-property' && !isPlayheadInTimelineItem(item, this.frame)) {
      await showUserWarning(
        '无法更新蒙版',
        '播放头不在当前片段时间范围内。请将播放头移动到片段内再尝试修改蒙版参数。',
      )
      throw new Error('播放头不在当前clip时间范围内，无法更新蒙版')
    }

    const itemLocalSize = this.getItemLocalSize(item)
    const currentMask = normalizeMaskConfig(item.config.mask, itemLocalSize)

    switch (this.action.type) {
      case 'set-property':
        await handlePropertyChange(item, this.frame, this.action.path, this.action.value)
        break
      case 'set-enabled':
        item.config.mask = { ...currentMask, enabled: this.action.value }
        break
      case 'set-type':
        item.config.mask = replaceMaskType(currentMask, this.action.value, itemLocalSize)
        break
      case 'set-inverted':
        item.config.mask = { ...currentMask, inverted: this.action.value }
        break
      case 'replace-config':
        item.config.mask = normalizeMaskConfig(
          {
            ...currentMask,
            ...this.action.value,
            falloff: {
              ...currentMask.falloff,
              ...(this.action.value.falloff ?? {}),
            },
          },
          itemLocalSize,
        )
        break
    }

    this.afterSnapshot = createSnapshot(item)

    if (this.playbackControls) {
      this.playbackControls.seekTo(this.frame)
    }
  }

  async undo(): Promise<void> {
    const item = this.timelineModule.getTimelineItem(this.timelineItemId)
    if (!item) {
      throw new Error(`时间轴项目不存在: ${this.timelineItemId}`)
    }

    await applyKeyframeSnapshot(item, this.beforeSnapshot)

    if (this.playbackControls) {
      this.playbackControls.seekTo(this.frame)
    }
  }

  get isDisposed(): boolean {
    return this._isDisposed
  }

  dispose(): void {
    if (this._isDisposed) return
    this._isDisposed = true
  }

  private getItemLocalSize(
    item: UnifiedTimelineItemData<Extract<MediaType, 'video' | 'image' | 'text'>>,
  ) {
    const config = TimelineItemQueries.getRenderConfig(item)
    return getItemLocalSize(config.width, config.height)
  }
}
