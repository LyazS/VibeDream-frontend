import { degreesToRadians } from '@/core/utils/rotationTransform'
import type { UnifiedMediaItemData } from '@/core/mediaitem/types'
import { TimelineItemQueries } from '@/core/timelineitem/queries'
import type { UnifiedTimelineItemData } from '@/core/timelineitem/type'
import { CompositeToMainPass } from '@/core/webgl2/passes/CompositeToMainPass'
import { DrawSourcePass } from '@/core/webgl2/passes/DrawSourcePass'
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
  targets: Pick<RenderTargetPool, 'releaseRenderTarget'>
  getSourceTextureId: (itemId: string) => string | null
  getMediaItem: (mediaItemId: string) => UnifiedMediaItemData | undefined
}

/**
 * 按 item 配置构建对应的渲染链。
 *
 * 当前仍然是固定的 source -> main 结构，
 * 但后续可以在这里根据 item 配置插入更多 effect/composite pass。
 */
export class ChainBuilder {
  constructor(private readonly params: ChainBuilderParams) {}

  build(item: VisualTimelineItem): RenderChain {
    const itemTargetTextureId = `item:${item.id}`
    const clockwiseRotationSourceTextureId = `clockwiseRotation-source:${item.id}`
    const clockwiseRotation = TimelineItemQueries.isVideoTimelineItem(item)
      ? this.params.getMediaItem(item.mediaItemId)?.runtime.bunny?.bunnyMedia
          ?.clockwiseRotation ??
        item.runtime.bunnyClip?.clockwiseRotation ??
        0
      : 0

    const passes = [
      new RotateSourcePass(
        `clockwiseRotation-source:${item.id}`,
        this.params.programs,
        clockwiseRotationSourceTextureId,
        this.params.targets,
        () => this.params.getSourceTextureId(item.id),
        clockwiseRotation,
      ),
      new DrawSourcePass(
        `draw:${item.id}`,
        this.params.programs,
        itemTargetTextureId,
        this.params.targets,
        () => clockwiseRotationSourceTextureId,
      ),
      new CompositeToMainPass(
        this.params.programs,
        `composite:${item.id}`,
        itemTargetTextureId,
        () => {
          const config = TimelineItemQueries.getRenderConfig(item)
          return {
            x: config.x,
            y: config.y,
            width: config.width,
            height: config.height,
            rotationRadians: degreesToRadians(-config.rotation),
            opacity: config.opacity ?? 1,
          }
        },
      ),
    ]

    return new RenderChain(`chain:${item.id}`, passes)
  }
}
