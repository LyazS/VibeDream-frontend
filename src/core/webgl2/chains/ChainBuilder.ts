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
    const maskedItemTextureId = `mask:${item.id}`
    const clockwiseRotationSourceTextureId = `clockwiseRotation-source:${item.id}`
    const clockwiseRotation = TimelineItemQueries.isVideoTimelineItem(item)
      ? this.params.getMediaItem(item.mediaItemId)?.runtime.bunny?.bunnyMedia
          ?.clockwiseRotation ??
        item.runtime.bunnyClip?.clockwiseRotation ??
        0
      : 0

    const renderConfig = TimelineItemQueries.getRenderConfig(item)
    const hasMask = Boolean(renderConfig.mask?.enabled)

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
          return {
            width: config.width,
            height: config.height,
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
            () => TimelineItemQueries.getRenderConfig(item).mask,
          )]
        : []),
      new CompositeToMainPass(
        this.params.programs,
        `composite:${item.id}`,
        hasMask ? maskedItemTextureId : itemTargetTextureId,
        renderConfig.blendMode ?? DEFAULT_BLEND_MODE,
        () => {
          const config = TimelineItemQueries.getRenderConfig(item)
          return {
            x: config.x,
            y: config.y,
            rotationRadians: degreesToRadians(-config.rotation),
            opacity: config.opacity ?? 1,
          }
        },
      ),
    ]

    return new RenderChain(`chain:${item.id}`, passes)
  }

  getSignature(item: VisualTimelineItem): string {
    const config = TimelineItemQueries.getRenderConfig(item)
    const mask = config.mask
    return `mask:${mask?.enabled ? 'on' : 'off'}:${mask?.type ?? 'rectangle'}:blend:${config.blendMode ?? DEFAULT_BLEND_MODE}`
  }
}
