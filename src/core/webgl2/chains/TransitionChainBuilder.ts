import type { UnifiedLibraryAssetData } from '@/core/asset/types'
import { EffectPackageFilterPass } from '@/core/effect-package/runtime/EffectPackageFilterPass'
import { EffectPackageTransitionPass } from '@/core/effect-package/runtime/EffectPackageTransitionPass'
import { effectTemplateRegistry } from '@/core/effect-template/EffectTemplateRegistry'
import { degreesToRadians } from '@/core/utils/rotationTransform'
import type { UnifiedMediaItemData } from '@/core/mediaitem/types'
import { DEFAULT_BLEND_MODE } from '@/core/timelineitem'
import { TimelineItemQueries } from '@/core/timelineitem/queries'
import {
  resolveClipTransitionPlaybackState,
  resolveTransitionBoundaryFrames,
} from '@/core/timelineitem/transition'
import type { UnifiedTimelineItemData } from '@/core/timelineitem/type'
import { resolveRenderConfigAtFrame, resolveRenderFilterEffectAtFrame } from '@/core/utils/animationInterpolation'
import { CompositeToMainPass } from '@/core/webgl2/passes/CompositeToMainPass'
import { CompositeToRenderTargetPass } from '@/core/webgl2/passes/CompositeToRenderTargetPass'
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
  getAsset: (assetId: string | null) => UnifiedLibraryAssetData | undefined
  getCurrentFrame: () => number
}

export class TransitionChainBuilder {
  constructor(private readonly params: TransitionChainBuilderParams) {}

  private resolveLoadedTransitionPackage(transitionItem: TransitionItem) {
    const effectPackageId = transitionItem.transitionOut?.effectPackageId
    return effectPackageId
      ? effectTemplateRegistry.getReadyPackage(effectPackageId)
      : null
  }

  private resolveLoadedFilterPackage(item: TransitionItem) {
    const filterEffect = TimelineItemQueries.getRenderFilterEffect(item)
    return filterEffect?.effectPackageId
      ? effectTemplateRegistry.getReadyPackage(filterEffect.effectPackageId)
      : null
  }

  build(transitionItem: TransitionItem, rightItem: TransitionItem): RenderChain {
    const leftCurrentOutput = `transition-left-current:${transitionItem.id}:projected`
    const leftEdgeOutput = `transition-left-edge:${transitionItem.id}:projected`
    const rightCurrentOutput = `transition-right-current:${transitionItem.id}:projected`
    const rightEdgeOutput = `transition-right-edge:${transitionItem.id}:projected`
    const mixedOutput = `transition-mixed:${transitionItem.id}`

    const loadedPackage = this.resolveLoadedTransitionPackage(transitionItem)
    if (!loadedPackage) {
      throw new Error(`转场片段缺少已安装的 effect package: ${transitionItem.id}`)
    }

    const passes = [
      ...this.buildBranchPasses({
        prefix: `transition-left-current:${transitionItem.id}`,
        item: transitionItem,
        getSourceTextureId: () => this.params.getSourceTextureId(transitionItem.id),
        getRenderConfig: () => TimelineItemQueries.getRenderConfig(transitionItem),
        getRenderFilterEffect: () => TimelineItemQueries.getRenderFilterEffect(transitionItem),
        getEffectEvaluationFrame: () => this.params.getCurrentFrame(),
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
        getRenderFilterEffect: () =>
          resolveRenderFilterEffectAtFrame(
            transitionItem,
            resolveTransitionBoundaryFrames(transitionItem).timelineTailFrame,
          ),
        getEffectEvaluationFrame: () => resolveTransitionBoundaryFrames(transitionItem).timelineTailFrame,
      }),
      ...this.buildBranchPasses({
        prefix: `transition-right-current:${transitionItem.id}`,
        item: rightItem,
        getSourceTextureId: () => this.params.getSourceTextureId(rightItem.id),
        getRenderConfig: () => TimelineItemQueries.getRenderConfig(rightItem),
        getRenderFilterEffect: () => TimelineItemQueries.getRenderFilterEffect(rightItem),
        getEffectEvaluationFrame: () => this.params.getCurrentFrame(),
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
        getRenderFilterEffect: () =>
          resolveRenderFilterEffectAtFrame(
            rightItem,
            resolveTransitionBoundaryFrames(rightItem).timelineHeadFrame,
          ),
        getEffectEvaluationFrame: () => resolveTransitionBoundaryFrames(rightItem).timelineHeadFrame,
      }),
      new EffectPackageTransitionPass(
        `transition-package:${transitionItem.id}`,
        loadedPackage,
        mixedOutput,
        () => this.params.getCurrentFrame(),
        () => this.getTransitionProgress(transitionItem),
        () => ({
          ...loadedPackage.payload.defaultParams,
          ...(transitionItem.transitionOut?.params ?? {}),
        }),
        () => {
          const playbackState = resolveClipTransitionPlaybackState(
            transitionItem,
            transitionItem.runtime.transition!,
            this.params.getCurrentFrame(),
          )

          return {
            'input:from':
              playbackState?.phase === 'entering-right' ? leftCurrentOutput : leftEdgeOutput,
            'input:to':
              playbackState?.phase === 'entering-right' ? rightEdgeOutput : rightCurrentOutput,
            'input:fromCurrent': leftCurrentOutput,
            'input:fromEdge': leftEdgeOutput,
            'input:toCurrent': rightCurrentOutput,
            'input:toEdge': rightEdgeOutput,
          }
        },
        (name) => `transition-package:${transitionItem.id}:${name}`,
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
    const loadedTransitionPackage = this.resolveLoadedTransitionPackage(transitionItem)
    return [
      `left:${this.getBranchSignature(transitionItem)}`,
      `right:${this.getBranchSignature(rightItem)}`,
      transitionItem.transitionOut?.effectPackageId ?? '',
      `transition-installed:${loadedTransitionPackage ? 'ready' : 'missing'}`,
      loadedTransitionPackage?.payload.version ?? transitionItem.transitionOut?.packagePayload?.version ?? '',
      loadedTransitionPackage?.payload.scriptHash ?? transitionItem.transitionOut?.packagePayload?.scriptHash ?? '',
    ].join('|')
  }

  private getTransitionProgress(transitionItem: TransitionItem): number {
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
  }

  private buildBranchPasses(params: {
    prefix: string
    item: TransitionItem
    getSourceTextureId: () => string | null
    getRenderConfig: () => any
    getRenderFilterEffect: () => ReturnType<typeof TimelineItemQueries.getRenderFilterEffect>
    getEffectEvaluationFrame: () => number
  }) {
    const rotatedTextureId = `${params.prefix}:rotated`
    const itemLocalTextureId = `${params.prefix}:item-local`
    const maskedTextureId = `${params.prefix}:masked`
    const filteredTextureId = `${params.prefix}:filtered`
    const projectedTextureId = `${params.prefix}:projected`
    const loadedFilterPackage = this.resolveLoadedFilterPackage(params.item)
    const hasFilter = Boolean(params.getRenderFilterEffect() && loadedFilterPackage)

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
      ...(hasFilter && loadedFilterPackage
        ? [new EffectPackageFilterPass(
            this.params.programs,
            this.params.targets,
            `${params.prefix}:filter`,
            loadedFilterPackage,
            filteredTextureId,
            params.getEffectEvaluationFrame,
            () => params.getRenderFilterEffect()?.intensity ?? 1,
            () => ({
              ...loadedFilterPackage.payload.defaultParams,
              ...(params.getRenderFilterEffect()?.params ?? {}),
            }),
            () => (params.getRenderConfig().mask?.enabled ? maskedTextureId : itemLocalTextureId),
            (name) => `${params.prefix}:filter:${name}`,
          )]
        : []),
      new CompositeToRenderTargetPass(
        this.params.programs,
        this.params.textures,
        this.params.targets,
        `${params.prefix}:project`,
        hasFilter
          ? filteredTextureId
          : (params.getRenderConfig().mask?.enabled ? maskedTextureId : itemLocalTextureId),
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
    const loadedFilterPackage = this.resolveLoadedFilterPackage(item)
    return [
      `blend:${item.config.blendMode ?? DEFAULT_BLEND_MODE}`,
      `mask:${mask?.enabled ? 'on' : 'off'}:${mask?.type ?? 'rectangle'}`,
      `filter:${TimelineItemQueries.getRenderFilterEffect(item)?.effectPackageId ?? ''}`,
      `filter-installed:${loadedFilterPackage ? 'ready' : 'missing'}`,
      `filter-version:${loadedFilterPackage?.payload.version ?? TimelineItemQueries.getRenderFilterEffect(item)?.packagePayload?.version ?? ''}`,
      `filter-script:${loadedFilterPackage?.payload.scriptHash ?? TimelineItemQueries.getRenderFilterEffect(item)?.packagePayload?.scriptHash ?? ''}`,
    ].join(':')
  }
}
