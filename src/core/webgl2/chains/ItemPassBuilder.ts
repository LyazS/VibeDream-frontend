import { EffectPackageFilterPass } from '@/core/effect-package/runtime/EffectPackageFilterPass'
import { normalizeEffectRuntimeParams } from '@/core/effect-package/runtimeParams'
import { effectTemplateRegistry } from '@/core/effect-template/EffectTemplateRegistry'
import type { UnifiedMediaItemData } from '@/core/mediaitem/types'
import { TimelineItemQueries } from '@/core/timelineitem/queries'
import type { TimelineBaseRenderConfig, UnifiedTimelineItemData } from '@/core/timelineitem/model/timelineItem'
import { ItemLocalRasterPass } from '@/core/webgl2/passes/ItemLocalRasterPass'
import { MaskPass } from '@/core/webgl2/passes/MaskPass'
import { RotateSourcePass } from '@/core/webgl2/passes/RotateSourcePass'
import type { RenderPass } from '@/core/webgl2/renderchain/RenderPass'
import type { ProgramManager } from '@/core/webgl2/runtime/ProgramManager'
import type { RenderTargetPool } from '@/core/webgl2/runtime/RenderTargetPool'

export type BuildableTimelineItem =
  | UnifiedTimelineItemData<'video'>
  | UnifiedTimelineItemData<'image'>
  | UnifiedTimelineItemData<'text'>

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
  getRenderMask: () => ReturnType<typeof TimelineItemQueries.getResolvedMask>
  getRenderFilterConfig: () => ReturnType<typeof TimelineItemQueries.getResolvedFilter>
  getEffectEvaluationFrame: () => number
}

export interface ItemPassBuildResult {
  passes: RenderPass[]
  outputTextureId: string
}

export class ItemPassBuilder {
  constructor(private readonly params: ItemPassBuilderParams) {}

  private resolveLoadedFilterPackage(
    getRenderFilterConfig: () => ReturnType<typeof TimelineItemQueries.getResolvedFilter>,
  ) {
    const filterConfig = getRenderFilterConfig()
    return filterConfig?.effectPackageId
      ? effectTemplateRegistry.getReadyPackage(filterConfig.effectPackageId)
      : null
  }

  build<TItem extends BuildableTimelineItem>(
    options: BuildItemPassesOptions<TItem>,
  ): ItemPassBuildResult {
    const rotatedTextureId = `${options.prefix}:rotated`
    const itemLocalTextureId = `${options.prefix}:item-local`
    const maskedTextureId = `${options.prefix}:masked`
    const filteredTextureId = `${options.prefix}:filtered`
    const loadedFilterPackage = this.resolveLoadedFilterPackage(options.getRenderFilterConfig)
    const hasFilter = Boolean(options.getRenderFilterConfig() && loadedFilterPackage)
    const hasMask = Boolean(options.getRenderMask()?.enabled)

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
        ...(hasFilter && loadedFilterPackage
          ? [new EffectPackageFilterPass(
              this.params.programs,
              this.params.targets,
              `${options.prefix}:filter`,
              loadedFilterPackage,
              filteredTextureId,
              options.getEffectEvaluationFrame,
              () => options.getRenderFilterConfig()?.intensity ?? 1,
              () =>
                normalizeEffectRuntimeParams(loadedFilterPackage.payload, {
                  ...loadedFilterPackage.payload.defaultParams,
                  ...(options.getRenderFilterConfig()?.params ?? {}),
                }),
              () => itemLocalTextureId,
              (name) => `${options.prefix}:filter:${name}`,
            )]
          : []),
        ...(hasMask
          ? [new MaskPass(
              `${options.prefix}:mask`,
              this.params.programs,
              hasFilter ? filteredTextureId : itemLocalTextureId,
              maskedTextureId,
              this.params.targets,
              options.getRenderMask,
            )]
          : []),
      ],
      outputTextureId: hasMask
        ? maskedTextureId
        : (hasFilter ? filteredTextureId : itemLocalTextureId),
    }
  }

  private getClockwiseRotation(item: BuildableTimelineItem): number {
    if (!TimelineItemQueries.isVideoTimelineItem(item)) {
      return 0
    }

    return (
      this.params.getMediaItem(item.mediaItemId)?.runtime.bunny?.bunnyMedia?.clockwiseRotation ??
      item.runtime.bunnyClip?.clockwiseRotation ??
      0
    )
  }
}
