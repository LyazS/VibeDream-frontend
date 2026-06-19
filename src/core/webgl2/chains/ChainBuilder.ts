import { effectTemplateRegistry } from '@/core/effect-template/EffectTemplateRegistry'
import { degreesToRadians } from '@/core/utils/rotationTransform'
import type { UnifiedMediaItemData } from '@/core/mediaitem/types'
import { DEFAULT_BLEND_MODE } from '@/core/timelineitem/model/blendMode'
import { TimelineItemQueries } from '@/core/timelineitem/queries'
import type { UnifiedTimelineItemData } from '@/core/timelineitem/model/timelineItem'
import { CompositeToMainPass } from '@/core/webgl2/passes/CompositeToMainPass'
import { RenderChain } from '@/core/webgl2/renderchain/RenderChain'
import type { ProgramManager } from '@/core/webgl2/runtime/ProgramManager'
import type { RenderTargetPool } from '@/core/webgl2/runtime/RenderTargetPool'
import { ItemPassBuilder } from '@/core/webgl2/chains/ItemPassBuilder'

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
  getCurrentFrame: () => number
}

/**
 * 按 item 配置构建对应的渲染链。
 *
 * 当前仍然是固定的 source -> main 结构，
 * 但后续可以在这里根据 item 配置插入更多 effect/composite pass。
 */
export class ChainBuilder {
  private readonly itemPassBuilder: ItemPassBuilder

  constructor(private readonly params: ChainBuilderParams) {
    this.itemPassBuilder = new ItemPassBuilder({
      programs: params.programs,
      targets: params.targets,
      getMediaItem: params.getMediaItem,
    })
  }

  build(item: VisualTimelineItem): RenderChain {
    const itemPassBuild = this.itemPassBuilder.build({
      prefix: `item:${item.id}`,
      item,
      getSourceTextureId: () => this.params.getSourceTextureId(item.id),
      getRenderConfig: () => TimelineItemQueries.getResolvedRenderConfig(item),
      getRenderMask: () => TimelineItemQueries.getResolvedMask(item),
      getRenderFilterConfig: () => TimelineItemQueries.getResolvedFilter(item),
      getEffectEvaluationFrame: () => this.params.getCurrentFrame(),
    })
    const renderConfig = TimelineItemQueries.getResolvedRenderConfig(item)

    const passes = [
      ...itemPassBuild.passes,
      new CompositeToMainPass(
        this.params.programs,
        `composite:${item.id}`,
        itemPassBuild.outputTextureId,
        renderConfig.visual.blendMode ?? DEFAULT_BLEND_MODE,
        () => {
          const config = TimelineItemQueries.getResolvedRenderConfig(item)
          return {
            x: config.visual.x,
            y: config.visual.y,
            rotationRadians: degreesToRadians(-config.visual.rotation),
            opacity: config.visual.opacity ?? 1,
          }
        },
      ),
    ]

    return new RenderChain(`chain:${item.id}`, passes)
  }

  getSignature(item: VisualTimelineItem): string {
    const config = TimelineItemQueries.getResolvedRenderConfig(item)
    const mask = TimelineItemQueries.getResolvedMask(item)
    const loadedFilterPackage = TimelineItemQueries.getResolvedFilter(item)?.effectPackageId
      ? effectTemplateRegistry.getReadyPackage(TimelineItemQueries.getResolvedFilter(item)?.effectPackageId ?? '')
      : null
    return [
      `mask:${mask?.enabled ? 'on' : 'off'}:${mask?.type ?? 'rectangle'}`,
      `blend:${config.visual.blendMode ?? DEFAULT_BLEND_MODE}`,
      `filter:${TimelineItemQueries.getResolvedFilter(item)?.effectPackageId ?? ''}`,
      `filter-installed:${loadedFilterPackage ? 'ready' : 'missing'}`,
      `filter-version:${loadedFilterPackage?.payload.version ?? TimelineItemQueries.getResolvedFilter(item)?.packagePayload?.version ?? ''}`,
      `filter-script:${loadedFilterPackage?.payload.scriptHash ?? TimelineItemQueries.getResolvedFilter(item)?.packagePayload?.scriptHash ?? ''}`,
    ].join(':')
  }
}
