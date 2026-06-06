import { generateCommandId } from '@/core/utils/idGenerator'
import type { SimpleCommand } from '@/core/modules/commands/types'
import type { AudioPropPatch, UnifiedTimelineItemData } from '@/core/timelineitem'
import type { MediaType, UnifiedMediaItemData } from '@/core/mediaitem'

export interface AudioPropertyUpdate {
  isMuted?: boolean
}

export class UpdateAudioPropertiesCommand implements SimpleCommand {
  public readonly id: string
  public readonly description: string
  private _isDisposed = false

  constructor(
    private timelineItemId: string,
    private oldValues: AudioPropertyUpdate,
    private newValues: AudioPropertyUpdate,
    private timelineModule: {
      setTimelineItemAudioPropsForCmd: (id: string, patch: AudioPropPatch) => void
      getTimelineItem: (id: string) => UnifiedTimelineItemData<MediaType> | undefined
    },
    private mediaModule: {
      getMediaItem: (id: string | null) => UnifiedMediaItemData | undefined
    },
  ) {
    this.id = generateCommandId()

    const timelineItem = this.timelineModule.getTimelineItem(timelineItemId)
    const mediaItem = timelineItem ? this.mediaModule.getMediaItem(timelineItem.mediaItemId) : null
    const oldMuted = this.oldValues.isMuted ? '静音' : '有声'
    const newMuted = this.newValues.isMuted ? '静音' : '有声'
    this.description = `更新音频属性: ${mediaItem?.name || '未知素材'} (静音状态: ${oldMuted} → ${newMuted})`
  }

  async execute(): Promise<void> {
    this.applyValues(this.newValues, '更新音频属性')
  }

  async undo(): Promise<void> {
    this.applyValues(this.oldValues, '撤销音频属性')
  }

  get isDisposed(): boolean {
    return this._isDisposed
  }

  dispose(): void {
    if (this._isDisposed) {
      return
    }

    this._isDisposed = true
    console.log(`🗑️ [UpdateAudioPropertiesCommand] 命令资源已清理: ${this.id}`)
  }

  private applyValues(values: AudioPropertyUpdate, action: string): void {
    const timelineItem = this.timelineModule.getTimelineItem(this.timelineItemId)
    if (!timelineItem) {
      console.warn(`⚠️ 时间轴项目不存在，无法${action}: ${this.timelineItemId}`)
      return
    }

    if (values.isMuted === undefined) {
      return
    }

    this.timelineModule.setTimelineItemAudioPropsForCmd(this.timelineItemId, {
      isMuted: values.isMuted,
    })
  }
}
