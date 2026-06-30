import type { UnifiedLibraryAssetData } from '@/core/asset/types'
import { EffectPackageTransitionPass } from '@/core/effect-package/runtime/EffectPackageTransitionPass'
import { normalizeEffectRuntimeParams } from '@/core/effect-package/runtimeParams'
import { effectTemplateRegistry } from '@/core/effect-template/EffectTemplateRegistry'
import type { UnifiedMediaItemData } from '@/core/mediaitem/types'
import { DEFAULT_BLEND_MODE } from '@/core/timelineitem/model/blendMode'
import { TimelineItemQueries } from '@/core/timelineitem/queries'
import {
  resolveClipTransitionPlaybackState,
  resolveTransitionBoundaryFrames,
} from '@/core/timelineitem/features/transition'
import type { TimelineBaseRenderConfig, UnifiedTimelineItemData } from '@/core/timelineitem/model/timelineItem'
import {
  resolveRenderConfigAtFrame,
  resolveRenderFilterConfigAtFrame,
  resolveRenderMaskAtFrame,
} from '@/core/utils/animationInterpolation'
import { degreesToRadians } from '@/core/utils/rotationTransform'
import { CompositeToRenderTargetPass } from '@/core/webgl2/passes/CompositeToRenderTargetPass'
import { CompositeToMainPass } from '@/core/webgl2/passes/CompositeToMainPass'
import { RenderChain } from '@/core/webgl2/renderchain/RenderChain'
import type { ProgramManager } from '@/core/webgl2/runtime/ProgramManager'
import type { RenderTargetPool } from '@/core/webgl2/runtime/RenderTargetPool'
import type { TextureManager } from '@/core/webgl2/runtime/TextureManager'
import { ItemPassBuilder } from '@/core/webgl2/chains/ItemPassBuilder'

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
  private readonly itemPassBuilder: ItemPassBuilder

  constructor(private readonly params: TransitionChainBuilderParams) {
    this.itemPassBuilder = new ItemPassBuilder({
      programs: params.programs,
      targets: params.targets,
      getMediaItem: params.getMediaItem,
    })
  }

  private resolveLoadedTransitionPackage(transitionItem: TransitionItem) {
    const effectPackageId = TimelineItemQueries.getResolvedTransition(transitionItem)?.effectPackageId
    return effectPackageId
      ? effectTemplateRegistry.getReadyPackage(effectPackageId)
      : null
  }

  private resolveLoadedFilterPackage(item: TransitionItem) {
    const filterConfig = TimelineItemQueries.getResolvedFilter(item)
    return filterConfig?.effectPackageId
      ? effectTemplateRegistry.getReadyPackage(filterConfig.effectPackageId)
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

    const leftBoundaryFrames = resolveTransitionBoundaryFrames(transitionItem)
    const rightBoundaryFrames = resolveTransitionBoundaryFrames(rightItem)

    const passes = [
      ...this.buildBranchPasses({
        prefix: `transition-left-current:${transitionItem.id}`,
        item: transitionItem,
        getSourceTextureId: () => this.params.getSourceTextureId(transitionItem.id),
        getRenderConfig: () => TimelineItemQueries.getResolvedRenderConfig(transitionItem),
        getRenderMask: () => TimelineItemQueries.getResolvedMask(transitionItem),
        getRenderFilterConfig: () => TimelineItemQueries.getResolvedFilter(transitionItem),
        getEffectEvaluationFrame: () => this.params.getCurrentFrame(),
      }),
      ...this.buildBranchPasses({
        prefix: `transition-left-edge:${transitionItem.id}`,
        item: transitionItem,
        getSourceTextureId: () => this.params.getTransitionEdgeTextureId(transitionItem.id, 'leftTail'),
        getRenderConfig: () =>
          resolveRenderConfigAtFrame(
            transitionItem,
            leftBoundaryFrames.timelineTailFrame,
          ),
        getRenderMask: () =>
          resolveRenderMaskAtFrame(
            transitionItem,
            leftBoundaryFrames.timelineTailFrame,
          ),
        getRenderFilterConfig: () =>
          resolveRenderFilterConfigAtFrame(
            transitionItem,
            leftBoundaryFrames.timelineTailFrame,
          ),
        getEffectEvaluationFrame: () => leftBoundaryFrames.timelineTailFrame,
      }),
      ...this.buildBranchPasses({
        prefix: `transition-right-current:${transitionItem.id}`,
        item: rightItem,
        getSourceTextureId: () => this.params.getSourceTextureId(rightItem.id),
        getRenderConfig: () => TimelineItemQueries.getResolvedRenderConfig(rightItem),
        getRenderMask: () => TimelineItemQueries.getResolvedMask(rightItem),
        getRenderFilterConfig: () => TimelineItemQueries.getResolvedFilter(rightItem),
        getEffectEvaluationFrame: () => this.params.getCurrentFrame(),
      }),
      ...this.buildBranchPasses({
        prefix: `transition-right-edge:${transitionItem.id}`,
        item: rightItem,
        getSourceTextureId: () => this.params.getTransitionEdgeTextureId(transitionItem.id, 'rightHead'),
        getRenderConfig: () =>
          resolveRenderConfigAtFrame(
            rightItem,
            rightBoundaryFrames.timelineHeadFrame,
          ),
        getRenderMask: () =>
          resolveRenderMaskAtFrame(
            rightItem,
            rightBoundaryFrames.timelineHeadFrame,
          ),
        getRenderFilterConfig: () =>
          resolveRenderFilterConfigAtFrame(
            rightItem,
            rightBoundaryFrames.timelineHeadFrame,
          ),
        getEffectEvaluationFrame: () => rightBoundaryFrames.timelineHeadFrame,
      }),
      new EffectPackageTransitionPass(
        `transition-package:${transitionItem.id}`,
        loadedPackage,
        mixedOutput,
        () => this.params.getCurrentFrame(),
        () => this.getTransitionProgress(transitionItem),
        () =>
          normalizeEffectRuntimeParams(loadedPackage.payload, {
            ...loadedPackage.payload.defaultParams,
            ...(TimelineItemQueries.getResolvedTransition(transitionItem)?.params ?? {}),
          }),
        () => {
          const transitionRuntime = transitionItem.runtime.transition
          if (!transitionRuntime) {
            throw new Error(`转场运行时信息缺失: ${transitionItem.id}`)
          }

          const playbackState = resolveClipTransitionPlaybackState(
            transitionItem,
            transitionRuntime,
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
          blendIntensity: 1,
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
      TimelineItemQueries.getResolvedTransition(transitionItem)?.effectPackageId ?? '',
      `transition-installed:${loadedTransitionPackage ? 'ready' : 'missing'}`,
      loadedTransitionPackage?.payload.version
        ?? TimelineItemQueries.getResolvedTransition(transitionItem)?.packagePayload?.version
        ?? '',
      loadedTransitionPackage?.payload.scriptHash
        ?? TimelineItemQueries.getResolvedTransition(transitionItem)?.packagePayload?.scriptHash
        ?? '',
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
    getRenderConfig: () => TimelineBaseRenderConfig<'video'> | TimelineBaseRenderConfig<'image'>
    getRenderMask: () => ReturnType<typeof TimelineItemQueries.getResolvedMask>
    getRenderFilterConfig: () => ReturnType<typeof TimelineItemQueries.getResolvedFilter>
    getEffectEvaluationFrame: () => number
  }) {
    const itemPassBuild = this.itemPassBuilder.build({
      prefix: params.prefix,
      item: params.item,
      getSourceTextureId: params.getSourceTextureId,
      getRenderConfig: params.getRenderConfig,
      getRenderMask: params.getRenderMask,
      getRenderFilterConfig: params.getRenderFilterConfig,
      getEffectEvaluationFrame: params.getEffectEvaluationFrame,
    })

    return [
      ...itemPassBuild.passes,
      new CompositeToRenderTargetPass(
        this.params.programs,
        this.params.textures,
        this.params.targets,
        `${params.prefix}:project`,
        itemPassBuild.outputTextureId,
        `${params.prefix}:projected`,
        params.getRenderConfig().visual.blendMode ?? DEFAULT_BLEND_MODE,
        () => {
          const config = params.getRenderConfig().visual
          return {
            x: config.x,
            y: config.y,
            rotationRadians: degreesToRadians(-config.rotation),
            blendIntensity: config.blendIntensity ?? 1,
          }
        },
      ),
    ]
  }

  private getBranchSignature(item: TransitionItem): string {
    const mask = TimelineItemQueries.getResolvedMask(item)
    const loadedFilterPackage = this.resolveLoadedFilterPackage(item)
    return [
      `time:${item.timeRange.timelineStartTime}-${item.timeRange.timelineEndTime}:${item.timeRange.clipStartTime}-${item.timeRange.clipEndTime}`,
      `blend:${TimelineItemQueries.getResolvedRenderConfig(item).visual.blendMode ?? DEFAULT_BLEND_MODE}`,
      `mask:${mask?.enabled ? 'on' : 'off'}:${mask?.type ?? 'rectangle'}`,
      `filter:${TimelineItemQueries.getResolvedFilter(item)?.effectPackageId ?? ''}`,
      `filter-installed:${loadedFilterPackage ? 'ready' : 'missing'}`,
      `filter-version:${loadedFilterPackage?.payload.version ?? TimelineItemQueries.getResolvedFilter(item)?.packagePayload?.version ?? ''}`,
      `filter-script:${loadedFilterPackage?.payload.scriptHash ?? TimelineItemQueries.getResolvedFilter(item)?.packagePayload?.scriptHash ?? ''}`,
    ].join(':')
  }
}
