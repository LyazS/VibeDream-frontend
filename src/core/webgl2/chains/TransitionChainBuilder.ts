import { degreesToRadians } from '@/core/utils/rotationTransform'
import type { UnifiedMediaItemData } from '@/core/mediaitem/types'
import { DEFAULT_BLEND_MODE } from '@/core/timelineitem'
import { TimelineItemQueries } from '@/core/timelineitem/queries'
import {
  resolveClipTransitionPlaybackState,
  resolveTransitionBoundaryFrames,
} from '@/core/timelineitem/transition'
import type { UnifiedTimelineItemData } from '@/core/timelineitem/type'
import { resolveRenderConfigAtFrame } from '@/core/utils/animationInterpolation'
import { CompositeToMainPass } from '@/core/webgl2/passes/CompositeToMainPass'
import { CompositeToRenderTargetPass } from '@/core/webgl2/passes/CompositeToRenderTargetPass'
import { CrossfadePass } from '@/core/webgl2/passes/CrossfadePass'
import { ItemLocalRasterPass } from '@/core/webgl2/passes/ItemLocalRasterPass'
import { MaskPass } from '@/core/webgl2/passes/MaskPass'
import { RotateSourcePass } from '@/core/webgl2/passes/RotateSourcePass'
import { RenderChain } from '@/core/webgl2/renderchain/RenderChain'
import type { ProgramManager } from '@/core/webgl2/runtime/ProgramManager'
import type { RenderTargetPool } from '@/core/webgl2/runtime/RenderTargetPool'
import type { TextureManager } from '@/core/webgl2/runtime/TextureManager'

type TransitionItem = UnifiedTimelineItemData<'video'> | UnifiedTimelineItemData<'image'>

interface TransitionChainBuilderParams {
  programs: Pick<ProgramManager, 'createProgram'>
  targets: Pick<RenderTargetPool, 'releaseRenderTarget' | 'ensureRenderTarget'>
  textures: Pick<TextureManager, 'remove'>
  getSourceTextureId: (itemId: string) => string | null
  getTransitionEdgeTextureId: (transitionItemId: string, edgeKey: 'leftTail' | 'rightHead') => string | null
  getMediaItem: (mediaItemId: string) => UnifiedMediaItemData | undefined
  getCurrentFrame: () => number
}

export class TransitionChainBuilder {
  constructor(private readonly params: TransitionChainBuilderParams) {}

  build(transitionItem: TransitionItem, rightItem: TransitionItem): RenderChain {
    const leftCurrentOutput = `transition-left-current:${transitionItem.id}:projected`
    const leftEdgeOutput = `transition-left-edge:${transitionItem.id}:projected`
    const rightCurrentOutput = `transition-right-current:${transitionItem.id}:projected`
    const rightEdgeOutput = `transition-right-edge:${transitionItem.id}:projected`
    const mixedOutput = `transition-mixed:${transitionItem.id}`

    const getPlaybackState = () =>
      resolveClipTransitionPlaybackState(
        transitionItem,
        transitionItem.runtime.transition!,
        this.params.getCurrentFrame(),
      )
    const transitionShader = transitionItem.transitionOut?.shader
    if (!transitionShader?.fragmentShader) {
      throw new Error(`转场片段缺少 shader 资源: ${transitionItem.id}`)
    }

    const passes = [
      ...this.buildBranchPasses({
        prefix: `transition-left-current:${transitionItem.id}`,
        item: transitionItem,
        getSourceTextureId: () => this.params.getSourceTextureId(transitionItem.id),
        getRenderConfig: () => TimelineItemQueries.getRenderConfig(transitionItem),
      }),
      ...this.buildBranchPasses({
        prefix: `transition-left-edge:${transitionItem.id}`,
        item: transitionItem,
        getSourceTextureId: () => this.params.getTransitionEdgeTextureId(transitionItem.id, 'leftTail'),
        getRenderConfig: () =>
          resolveRenderConfigAtFrame(
            transitionItem,
            resolveTransitionBoundaryFrames(transitionItem).timelineTailFrame,
          ),
      }),
      ...this.buildBranchPasses({
        prefix: `transition-right-current:${transitionItem.id}`,
        item: rightItem,
        getSourceTextureId: () => this.params.getSourceTextureId(rightItem.id),
        getRenderConfig: () => TimelineItemQueries.getRenderConfig(rightItem),
      }),
      ...this.buildBranchPasses({
        prefix: `transition-right-edge:${transitionItem.id}`,
        item: rightItem,
        getSourceTextureId: () => this.params.getTransitionEdgeTextureId(transitionItem.id, 'rightHead'),
        getRenderConfig: () =>
          resolveRenderConfigAtFrame(
            rightItem,
            resolveTransitionBoundaryFrames(rightItem).timelineHeadFrame,
          ),
      }),
      new CrossfadePass(
        `transition-crossfade:${transitionItem.id}`,
        this.params.programs,
        mixedOutput,
        this.params.targets,
        () => {
          const playbackState = getPlaybackState()
          if (!playbackState) {
            return null
          }
          return playbackState.phase === 'entering-right' ? leftCurrentOutput : leftEdgeOutput
        },
        () => {
          const playbackState = getPlaybackState()
          if (!playbackState) {
            return null
          }
          return playbackState.phase === 'entering-right' ? rightEdgeOutput : rightCurrentOutput
        },
        () => {
          const runtime = transitionItem.runtime.transition
          const currentFrame = this.params.getCurrentFrame()
          if (
            !runtime ||
            runtime.activeRangeStart === null ||
            runtime.activeRangeEnd === null ||
            currentFrame < runtime.activeRangeStart ||
            currentFrame >= runtime.activeRangeEnd
          ) {
            return 0
          }
          const totalFrames = Math.max(1, runtime.activeRangeEnd - runtime.activeRangeStart)
          return Math.min(1, Math.max(0, (currentFrame - runtime.activeRangeStart) / totalFrames))
        },
        transitionShader.fragmentShader,
        transitionShader.vertexShader,
      ),
      new CompositeToMainPass(
        this.params.programs,
        `transition-present:${transitionItem.id}`,
        mixedOutput,
        'normal',
        () => ({
          x: 0,
          y: 0,
          rotationRadians: 0,
          opacity: 1,
        }),
      ),
    ]

    return new RenderChain(`transition-chain:${transitionItem.id}`, passes)
  }

  getSignature(transitionItem: TransitionItem, rightItem: TransitionItem): string {
    return [
      `left:${this.getBranchSignature(transitionItem)}`,
      `right:${this.getBranchSignature(rightItem)}`,
      transitionItem.transitionOut?.templateAssetId ?? '',
      transitionItem.transitionOut?.shader.fragmentShader ?? '',
    ].join('|')
  }

  private buildBranchPasses(params: {
    prefix: string
    item: TransitionItem
    getSourceTextureId: () => string | null
    getRenderConfig: () => any
  }) {
    const rotatedTextureId = `${params.prefix}:rotated`
    const itemLocalTextureId = `${params.prefix}:item-local`
    const maskedTextureId = `${params.prefix}:masked`
    const projectedTextureId = `${params.prefix}:projected`

    return [
      new RotateSourcePass(
        `${params.prefix}:rotate`,
        this.params.programs,
        rotatedTextureId,
        this.params.targets,
        params.getSourceTextureId,
        this.getClockwiseRotation(params.item),
      ),
      new ItemLocalRasterPass(
        `${params.prefix}:item-local`,
        this.params.programs,
        itemLocalTextureId,
        this.params.targets,
        () => rotatedTextureId,
        () => {
          const config = params.getRenderConfig() as { width: number; height: number }
          return {
            width: config.width,
            height: config.height,
          }
        },
      ),
      new MaskPass(
        `${params.prefix}:mask`,
        this.params.programs,
        itemLocalTextureId,
        maskedTextureId,
        this.params.targets,
        () => (params.getRenderConfig() as { mask?: unknown }).mask as never,
      ),
      new CompositeToRenderTargetPass(
        this.params.programs,
        this.params.textures,
        this.params.targets,
        `${params.prefix}:project`,
        params.getRenderConfig().mask?.enabled ? maskedTextureId : itemLocalTextureId,
        projectedTextureId,
        params.item.config.blendMode ?? DEFAULT_BLEND_MODE,
        () => {
          const config = params.getRenderConfig() as {
            x: number
            y: number
            rotation: number
            opacity?: number
          }
          return {
            x: config.x,
            y: config.y,
            rotationRadians: degreesToRadians(-config.rotation),
            opacity: config.opacity ?? 1,
          }
        },
      ),
    ]
  }

  private getClockwiseRotation(item: TransitionItem): number {
    if (!TimelineItemQueries.isVideoTimelineItem(item)) {
      return 0
    }

    return (
      this.params.getMediaItem(item.mediaItemId)?.runtime.bunny?.bunnyMedia?.clockwiseRotation ??
      item.runtime.bunnyClip?.clockwiseRotation ??
      0
    )
  }

  private getBranchSignature(item: TransitionItem): string {
    const mask = item.config.mask
    return `blend:${item.config.blendMode ?? DEFAULT_BLEND_MODE}:mask:${mask?.enabled ? 'on' : 'off'}:${mask?.type ?? 'rectangle'}`
  }
}
