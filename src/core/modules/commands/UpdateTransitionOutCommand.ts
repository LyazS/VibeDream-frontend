import { generateCommandId } from '@/core/utils/idGenerator'
import type { SimpleCommand } from '@/core/modules/commands/types'
import type { UnifiedTimelineItemData } from '@/core/timelineitem/type'
import type { MediaType } from '@/core/mediaitem/types'
import type { ClipTransitionOutConfig } from '@/core/transition/types'
import { isEffectTemplateAsset, type UnifiedLibraryAssetData } from '@/core/asset/types'

export class UpdateTransitionOutCommand implements SimpleCommand {
  public readonly id: string
  public readonly description: string
  private _isDisposed = false

  constructor(
    private readonly timelineItemId: string,
    private readonly oldValue: ClipTransitionOutConfig | undefined,
    private readonly newValue: ClipTransitionOutConfig | undefined,
    private readonly timelineModule: {
      getTimelineItem: (id: string) => UnifiedTimelineItemData<MediaType> | undefined
      setTimelineItemTransitionOutForCmd: (
        id: string,
        transitionOut?: ClipTransitionOutConfig,
      ) => void
    },
    private readonly mediaModule: {
      getAsset: (id: string | null) => UnifiedLibraryAssetData | undefined
    },
  ) {
    this.id = generateCommandId()
    this.description = '更新片段转场'
  }

  async execute(): Promise<void> {
    this.apply(this.newValue)
  }

  async undo(): Promise<void> {
    this.apply(this.oldValue)
  }

  private apply(nextValue?: ClipTransitionOutConfig): void {
    const item = this.timelineModule.getTimelineItem(this.timelineItemId)
    if (!item) {
      throw new Error(`时间轴项目不存在: ${this.timelineItemId}`)
    }

    if (nextValue?.templateAssetId) {
      const templateAsset = this.mediaModule.getAsset(nextValue.templateAssetId)
      if (!isEffectTemplateAsset(templateAsset)) {
        throw new Error(`转场效果素材不存在或类型无效: ${nextValue.templateAssetId}`)
      }
    }

    this.timelineModule.setTimelineItemTransitionOutForCmd(this.timelineItemId, nextValue)
  }

  get isDisposed(): boolean {
    return this._isDisposed
  }

  dispose(): void {
    if (this._isDisposed) {
      return
    }
    this._isDisposed = true
  }
}
