import { generateCommandId } from '@/core/utils/idGenerator'
import type { SimpleCommand } from '@/core/modules/commands/types'
import type { UnifiedTimelineItemData } from '@/core/timelineitem/type'
import type { MediaType } from '@/core/mediaitem/types'
import type { ClipFilterConfig } from '@/core/filter/types'
import { supportsClipFilter } from '@/core/timelineitem/filter'
import {
  isEffectTemplateAsset,
  isReadyEffectTemplateAsset,
  type UnifiedLibraryAssetData,
} from '@/core/asset/types'

export class UpdateFilterEffectCommand implements SimpleCommand {
  public readonly id: string
  public readonly description: string
  private _isDisposed = false

  constructor(
    private readonly timelineItemId: string,
    private readonly oldValue: ClipFilterConfig | undefined,
    private readonly newValue: ClipFilterConfig | undefined,
    private readonly timelineModule: {
      getTimelineItem: (id: string) => UnifiedTimelineItemData<MediaType> | undefined
      setTimelineItemFilterEffectForCmd: (
        id: string,
        filterEffect?: ClipFilterConfig,
      ) => void
    },
    private readonly mediaModule: {
      getAsset: (id: string | null) => UnifiedLibraryAssetData | undefined
    },
  ) {
    this.id = generateCommandId()
    this.description = '更新片段滤镜'
  }

  async execute(): Promise<void> {
    this.apply(this.newValue)
  }

  async undo(): Promise<void> {
    this.apply(this.oldValue)
  }

  private apply(nextValue?: ClipFilterConfig): void {
    const item = this.timelineModule.getTimelineItem(this.timelineItemId)
    if (!item) {
      throw new Error(`时间轴项目不存在: ${this.timelineItemId}`)
    }

    if (!supportsClipFilter(item)) {
      throw new Error(`当前片段类型不支持滤镜: ${this.timelineItemId}`)
    }

    const targetAssetId = nextValue?.assetId
    if (targetAssetId) {
      const templateAsset = this.mediaModule.getAsset(targetAssetId)
      if (!isEffectTemplateAsset(templateAsset) || templateAsset.effectType !== 'filter') {
        throw new Error(`滤镜效果素材不存在或类型无效: ${targetAssetId}`)
      }
      if (!isReadyEffectTemplateAsset(templateAsset)) {
        throw new Error(`滤镜效果素材尚未就绪: ${targetAssetId}`)
      }
    }

    this.timelineModule.setTimelineItemFilterEffectForCmd(this.timelineItemId, nextValue)
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
