import type { UnifiedMediaItemData } from '@/core/mediaitem/types'
import type { TimelineBaseRenderConfig, UnifiedTimelineItemData } from '@/core/timelineitem/model/timelineItem'
import { ItemLocalRasterPass } from '@/core/webgl2/passes/ItemLocalRasterPass'
import { RotateSourcePass } from '@/core/webgl2/passes/RotateSourcePass'
import type { RenderPass } from '@/core/webgl2/renderchain/RenderPass'
import type { ProgramManager } from '@/core/webgl2/runtime/ProgramManager'
import type { RenderTargetPool } from '@/core/webgl2/runtime/RenderTargetPool'

export type BuildableTimelineItem =
  | UnifiedTimelineItemData<'video'>
  | UnifiedTimelineItemData<'image'>

interface ItemPassBuilderParams {
  programs: Pick<ProgramManager, 'createProgram'>
  targets: Pick<RenderTargetPool, 'releaseRenderTarget' | 'ensureRenderTarget'>
  getMediaItem: (mediaItemId: string) => UnifiedMediaItemData | undefined
}

interface BuildItemPassesOptions<TItem extends BuildableTimelineItem> {
  prefix: string
  item: TItem
  getSourceTextureId: () => string | null
  getRenderConfig: () => TimelineBaseRenderConfig<TItem['mediaType']>
}

export interface ItemPassBuildResult {
  passes: RenderPass[]
  outputTextureId: string
}

export class ItemPassBuilder {
  constructor(private readonly params: ItemPassBuilderParams) {}

  build<TItem extends BuildableTimelineItem>(
    options: BuildItemPassesOptions<TItem>,
  ): ItemPassBuildResult {
    const rotatedTextureId = `${options.prefix}:rotated`
    const itemLocalTextureId = `${options.prefix}:item-local`

    return {
      passes: [
        new RotateSourcePass(
          `${options.prefix}:rotate`,
          this.params.programs,
          rotatedTextureId,
          this.params.targets,
          options.getSourceTextureId,
          this.getClockwiseRotation(options.item),
        ),
        new ItemLocalRasterPass(
          `${options.prefix}:item-local`,
          this.params.programs,
          itemLocalTextureId,
          this.params.targets,
          () => rotatedTextureId,
          () => {
            const config = options.getRenderConfig().visual
            return {
              width: config.width ?? 0,
              height: config.height ?? 0,
            }
          },
        ),
      ],
      outputTextureId: itemLocalTextureId,
    }
  }

  private getClockwiseRotation(item: BuildableTimelineItem): number {
    if (item.mediaType !== 'video') {
      return 0
    }

    return (
      this.params.getMediaItem(item.mediaItemId)?.runtime.bunny?.bunnyMedia?.clockwiseRotation ??
      item.runtime.bunnyClip?.clockwiseRotation ??
      0
    )
  }
}
