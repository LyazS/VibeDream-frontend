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

export type VisualTimelineItem =
  | UnifiedTimelineItemData<'video'>
  | UnifiedTimelineItemData<'image'>

interface ChainBuilderParams {
  programs: Pick<ProgramManager, 'createProgram'>
  targets: Pick<RenderTargetPool, 'releaseRenderTarget' | 'ensureRenderTarget'>
  getSourceTextureId: (itemId: string) => string
  getMediaItem: (mediaItemId: string) => UnifiedMediaItemData | undefined
}

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
            blendIntensity: config.visual.blendIntensity ?? 1,
          }
        },
      ),
    ]

    return new RenderChain(`chain:${item.id}`, passes)
  }

  getSignature(item: VisualTimelineItem): string {
    const config = TimelineItemQueries.getResolvedRenderConfig(item)
    return `blend:${config.visual.blendMode ?? DEFAULT_BLEND_MODE}`
  }
}
