import type { UnifiedLibraryAssetData } from '@/core/asset/types'
import { EffectPackageFilterPass } from '@/core/effect-package/runtime/EffectPackageFilterPass'
import { effectTemplateRegistry } from '@/core/effect-template/EffectTemplateRegistry'
import { degreesToRadians } from '@/core/utils/rotationTransform'
import type { UnifiedMediaItemData } from '@/core/mediaitem/types'
import { DEFAULT_BLEND_MODE } from '@/core/timelineitem'
import { TimelineItemQueries } from '@/core/timelineitem/queries'
import type { UnifiedTimelineItemData } from '@/core/timelineitem/type'
import { CompositeToMainPass } from '@/core/webgl2/passes/CompositeToMainPass'
import { ItemLocalRasterPass } from '@/core/webgl2/passes/ItemLocalRasterPass'
import { MaskPass } from '@/core/webgl2/passes/MaskPass'
import { RotateSourcePass } from '@/core/webgl2/passes/RotateSourcePass'
import { RenderChain } from '@/core/webgl2/renderchain/RenderChain'
import type { ProgramManager } from '@/core/webgl2/runtime/ProgramManager'
import type { RenderTargetPool } from '@/core/webgl2/runtime/RenderTargetPool'

/**
 * 当前可映射到 RenderChain 的可视 item。
 */
export type VisualTimelineItem =
  | UnifiedTimelineItemData<'video'>
  | UnifiedTimelineItemData<'image'>
  | UnifiedTimelineItemData<'text'>

interface ChainBuilderParams {
  programs: Pick<ProgramManager, 'createProgram'>
  targets: Pick<RenderTargetPool, 'releaseRenderTarget' | 'ensureRenderTarget'>
  getSourceTextureId: (itemId: string) => string | null
  getMediaItem: (mediaItemId: string) => UnifiedMediaItemData | undefined
  getAsset: (assetId: string | null) => UnifiedLibraryAssetData | undefined
  getCurrentFrame: () => number
}

/**
 * 按 item 配置构建对应的渲染链。
 *
 * 当前仍然是固定的 source -> main 结构，
 * 但后续可以在这里根据 item 配置插入更多 effect/composite pass。
 */
export class ChainBuilder {
  constructor(private readonly params: ChainBuilderParams) {}

  private resolveLoadedFilterPackage(item: VisualTimelineItem) {
    const filterEffect = TimelineItemQueries.getRenderFilterEffect(item)
    return filterEffect?.effectPackageId
      ? effectTemplateRegistry.getReadyPackage(filterEffect.effectPackageId)
      : null
  }

  build(item: VisualTimelineItem): RenderChain {
    const itemTargetTextureId = `item:${item.id}`
    const maskedItemTextureId = `mask:${item.id}`
    const filteredItemTextureId = `filter:${item.id}`
    const clockwiseRotationSourceTextureId = `clockwiseRotation-source:${item.id}`
    const clockwiseRotation = TimelineItemQueries.isVideoTimelineItem(item)
      ? this.params.getMediaItem(item.mediaItemId)?.runtime.bunny?.bunnyMedia
          ?.clockwiseRotation ??
        item.runtime.bunnyClip?.clockwiseRotation ??
        0
      : 0

    const renderConfig = TimelineItemQueries.getRenderConfig(item)
    const visualConfig = TimelineItemQueries.getVisualRenderConfig(item, renderConfig)
    const renderMask = TimelineItemQueries.getRenderMask(item)
    const renderFilterEffect = TimelineItemQueries.getRenderFilterEffect(item)
    const hasMask = Boolean(renderMask?.enabled)
    const loadedFilterPackage = this.resolveLoadedFilterPackage(item)
    const hasFilter = Boolean(renderFilterEffect && loadedFilterPackage)
    const getEffectEvaluationFrame = () => this.params.getCurrentFrame()

    const passes = [
      new RotateSourcePass(
        `clockwiseRotation-source:${item.id}`,
        this.params.programs,
        clockwiseRotationSourceTextureId,
        this.params.targets,
        () => this.params.getSourceTextureId(item.id),
        clockwiseRotation,
      ),
      new ItemLocalRasterPass(
        `item-local:${item.id}`,
        this.params.programs,
        itemTargetTextureId,
        this.params.targets,
        () => clockwiseRotationSourceTextureId,
        () => {
          const config = TimelineItemQueries.getRenderConfig(item)
          const visual = TimelineItemQueries.getVisualRenderConfig(item, config)
          return {
            width: visual.width,
            height: visual.height,
          }
        },
      ),
      ...(hasMask
        ? [new MaskPass(
            `mask:${item.id}`,
            this.params.programs,
            itemTargetTextureId,
            maskedItemTextureId,
            this.params.targets,
            () => TimelineItemQueries.getRenderMask(item),
          )]
        : []),
      ...(hasFilter && loadedFilterPackage
        ? [new EffectPackageFilterPass(
            this.params.programs,
            this.params.targets,
            `filter:${item.id}`,
            loadedFilterPackage,
            filteredItemTextureId,
            getEffectEvaluationFrame,
            () => TimelineItemQueries.getRenderFilterEffect(item)?.intensity ?? 1,
            () => ({
              ...loadedFilterPackage.payload.defaultParams,
              ...(TimelineItemQueries.getRenderFilterEffect(item)?.params ?? {}),
            }),
            () => (hasMask ? maskedItemTextureId : itemTargetTextureId),
            (name) => `filter:${item.id}:${name}`,
          )]
        : []),
      new CompositeToMainPass(
        this.params.programs,
        `composite:${item.id}`,
        hasFilter ? filteredItemTextureId : (hasMask ? maskedItemTextureId : itemTargetTextureId),
        visualConfig.blendMode ?? DEFAULT_BLEND_MODE,
        () => {
          const config = TimelineItemQueries.getRenderConfig(item)
          const visual = TimelineItemQueries.getVisualRenderConfig(item, config)
          return {
            x: visual.x,
            y: visual.y,
            rotationRadians: degreesToRadians(-visual.rotation),
            opacity: visual.opacity ?? 1,
          }
        },
      ),
    ]

    return new RenderChain(`chain:${item.id}`, passes)
  }

  getSignature(item: VisualTimelineItem): string {
    const config = TimelineItemQueries.getRenderConfig(item)
    const visual = TimelineItemQueries.getVisualRenderConfig(item, config)
    const mask = TimelineItemQueries.getRenderMask(item)
    const loadedFilterPackage = this.resolveLoadedFilterPackage(item)
    return [
      `mask:${mask?.enabled ? 'on' : 'off'}:${mask?.type ?? 'rectangle'}`,
      `blend:${visual.blendMode ?? DEFAULT_BLEND_MODE}`,
      `filter:${TimelineItemQueries.getRenderFilterEffect(item)?.effectPackageId ?? ''}`,
      `filter-installed:${loadedFilterPackage ? 'ready' : 'missing'}`,
      `filter-version:${loadedFilterPackage?.payload.version ?? TimelineItemQueries.getRenderFilterEffect(item)?.packagePayload?.version ?? ''}`,
      `filter-script:${loadedFilterPackage?.payload.scriptHash ?? TimelineItemQueries.getRenderFilterEffect(item)?.packagePayload?.scriptHash ?? ''}`,
    ].join(':')
  }
}
