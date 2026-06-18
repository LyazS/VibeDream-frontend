import type { UnifiedLibraryAssetData } from '@/core/asset/types'
import type { UnifiedTimelineItemData } from '@/core/timelineitem/model/timelineItem'
import type { MediaType, UnifiedMediaItemData } from '@/core/mediaitem/types'
import { WebGL2Runtime } from '@/core/webgl2/runtime/WebGL2Runtime'
import { ClearMainPass } from '@/core/webgl2/passes/ClearMainPass'
import { PresentPass } from '@/core/webgl2/passes/PresentPass'
import { getVisibleRenderableItems } from '@/core/webgl2/utils/RenderItemVisibility'
import { ChainBuilder } from '@/core/webgl2/chains/ChainBuilder'
import { TimelineRenderChainAdapter } from '@/core/webgl2/chains/TimelineRenderChainAdapter'
import { TransitionChainBuilder } from '@/core/webgl2/chains/TransitionChainBuilder'
import { TransitionRenderChainAdapter } from '@/core/webgl2/chains/TransitionRenderChainAdapter'
import { SourceTextureUploader } from '@/core/webgl2/renderer/SourceTextureUploader'
import type { RenderPassContext } from '@/core/webgl2/renderchain/RenderPassContext'
import type { FrameData } from '@/core/webgl2/types'
import { TimelineItemQueries } from '@/core/timelineitem/queries'
import {
  hasEnabledClipTransitionOut,
  resolveClipTransitionPlaybackState,
} from '@/core/timelineitem/features/transition'

/**
 * 渲染器构造所需的宿主依赖。
 *
 * 这些依赖都来自时间轴/媒体模块，用函数形式传入，
 * 避免渲染器直接耦合到更高层模块实例。
 */
interface TimelineWebGLRendererOptions {
  canvas: HTMLCanvasElement
  getTrack: (trackId: string) => { isVisible: boolean } | undefined
  getMediaItem: (mediaItemId: string) => UnifiedMediaItemData | undefined
  getAsset: (assetId: string | null) => UnifiedLibraryAssetData | undefined
  trackIndexMap: () => Map<string, number>
  getSelectedTimelineItemId?: () => string | null
}

/**
 * 时间轴预览用的 WebGL2 渲染器。
 *
 * 执行顺序固定为：
 * 1. 同步主画面尺寸
 * 2. 清空主画面
 * 3. 过滤当前帧可见 item
 * 4. 为每个 item 上传 source texture
 * 5. 执行 item 的 RenderChain
 * 6. present 到 canvas
 */
export class TimelineWebGLRenderer {
  private readonly runtime: WebGL2Runtime
  private readonly clearPass: ClearMainPass
  private readonly presentPass: PresentPass
  private readonly sourceUploader: SourceTextureUploader
  private readonly chainBuilder: ChainBuilder
  private readonly chainAdapter: TimelineRenderChainAdapter
  private readonly transitionChainBuilder: TransitionChainBuilder
  private readonly transitionChainAdapter: TransitionRenderChainAdapter
  private readonly knownTransitionEdgeItemIds = new Set<string>()
  private currentRenderFrame = 0

  constructor(private readonly options: TimelineWebGLRendererOptions) {
    this.runtime = new WebGL2Runtime(options.canvas)
    this.clearPass = new ClearMainPass()
    this.presentPass = new PresentPass(this.runtime.programs)
    this.sourceUploader = new SourceTextureUploader(this.runtime, options.getMediaItem)
    this.chainBuilder = new ChainBuilder({
      programs: this.runtime.programs,
      targets: this.runtime.targets,
      getSourceTextureId: (itemId) => this.sourceUploader.getTextureIdForItem(itemId),
      getMediaItem: options.getMediaItem,
      getAsset: options.getAsset,
      getCurrentFrame: () => this.currentRenderFrame,
    })
    this.chainAdapter = new TimelineRenderChainAdapter(this.chainBuilder)
    this.transitionChainBuilder = new TransitionChainBuilder({
      programs: this.runtime.programs,
      targets: this.runtime.targets,
      textures: this.runtime.textures,
      getSourceTextureId: (itemId) => this.sourceUploader.getTextureIdForItem(itemId),
      getTransitionEdgeTextureId: (transitionItemId, edgeKey) =>
        this.getTransitionEdgeTextureId(transitionItemId, edgeKey),
      getMediaItem: options.getMediaItem,
      getAsset: options.getAsset,
      getCurrentFrame: () => this.currentRenderFrame,
    })
    this.transitionChainAdapter = new TransitionRenderChainAdapter(this.transitionChainBuilder)
  }

  /**
   * 执行一帧完整的时间轴预览渲染。
   */
  render(
    timelineItems: UnifiedTimelineItemData<MediaType>[],
    currentFrame: number,
    bunnyCurFrameMap: Map<string, FrameData>,
  ): void {
    this.currentRenderFrame = currentFrame
    this.pruneTransitionEdgeTextures(timelineItems)

    // 主画面 target 在这里按当前 canvas 尺寸确保可用；item 级中间 target 由各个 pass 自己管理。
    const mainTarget = this.runtime.targets.ensureMainTarget(
      this.options.canvas.width,
      this.options.canvas.height,
    )

    const ctx: RenderPassContext = {
      gl: this.runtime.gl,
      runtime: this.runtime,
      textures: this.runtime.textures,
      targets: this.runtime.targets,
      frame: currentFrame,
      canvasWidth: this.options.canvas.width,
      canvasHeight: this.options.canvas.height,
      mainTarget,
    }

    this.clearPass.render(ctx)

    const selectedTimelineItemId = this.options.getSelectedTimelineItemId?.() ?? null
    const selectedBoundaryItem =
      selectedTimelineItemId
        ? timelineItems.find(
            (item) =>
              item.id === selectedTimelineItemId &&
              currentFrame === item.timeRange.timelineEndTime,
          ) ?? null
        : null

    // 这里先在 CPU 侧完成时间范围、轨道可见性和素材就绪判断，避免无意义的 texture 上传和 draw call。
    const visibleItems = getVisibleRenderableItems(timelineItems, {
      currentFrame,
      canvasWidth: this.options.canvas.width,
      canvasHeight: this.options.canvas.height,
      bunnyCurFrameMap,
      getTrack: this.options.getTrack,
      getMediaItem: this.options.getMediaItem,
      trackIndexMap: this.options.trackIndexMap(),
      selectedBoundaryItemId: selectedBoundaryItem?.id ?? null,
      selectedBoundaryTrackId: selectedBoundaryItem?.trackId ?? null,
    })

    const activeTransitions = this.collectActiveTransitions(timelineItems, currentFrame)
    const consumedItemIds = new Set<string>()

    for (const transition of activeTransitions) {
      consumedItemIds.add(transition.transitionItem.id)
      consumedItemIds.add(transition.rightItem.id)
    }

    const renderQueue = [
      ...visibleItems
        .filter((item) => !consumedItemIds.has(item.id))
        .map((item) => ({
          kind: 'item' as const,
          trackId: item.trackId,
          item,
        })),
      ...activeTransitions.map((transition) => ({
        kind: 'transition' as const,
        trackId: transition.transitionItem.trackId,
        transition,
      })),
    ].sort((left, right) => {
      const leftIndex = this.options.trackIndexMap().get(left.trackId) ?? -Infinity
      const rightIndex = this.options.trackIndexMap().get(right.trackId) ?? -Infinity
      return rightIndex - leftIndex
    })

    for (const entry of renderQueue) {
      if (entry.kind === 'item') {
        this.sourceUploader.ensureTextureForItem(entry.item, bunnyCurFrameMap)
        this.chainAdapter.getChain(entry.item).render(ctx)
        continue
      }

      this.sourceUploader.ensureTextureForItem(entry.transition.transitionItem, bunnyCurFrameMap)
      this.sourceUploader.ensureTextureForItem(entry.transition.rightItem, bunnyCurFrameMap)
      this.ensureTransitionEdgeTextures(entry.transition.transitionItem)
      this.transitionChainAdapter
        .getChain(entry.transition.transitionItem, entry.transition.rightItem)
        .render(ctx)
    }

    // 预览与导出统一走 present 到 canvas 的路径，
    // 保证最终可见画面与可编码画面完全一致。
    this.presentPass.render(ctx)
  }

  /**
   * 为即将进入窗口的可视 item 预热渲染链。
   * 这里只构建并缓存链对象，不做 texture 上传，也不触发 draw。
   */
  prepareRenderChains(timelineItems: UnifiedTimelineItemData<MediaType>[]): void {
    for (const item of timelineItems) {
      if (
        TimelineItemQueries.isVideoTimelineItem(item) ||
        TimelineItemQueries.isImageTimelineItem(item) ||
        TimelineItemQueries.isTextTimelineItem(item)
      ) {
        this.chainAdapter.prepareChain(item)
      }

      if (
        hasEnabledClipTransitionOut(item) &&
        item.runtime.transition?.rightItemId
      ) {
        const rightItem = timelineItems.find(
          (candidate) => candidate.id === item.runtime.transition?.rightItemId,
        )
        if (rightItem && TimelineItemQueries.supportsClipTransitionOut(rightItem)) {
          this.transitionChainAdapter.getChain(item, rightItem)
        }
      }
    }
  }

  /**
   * 仅清空默认 framebuffer，用于模块销毁时把最后一帧画面擦除。
   */
  clear(): void {
    const gl = this.runtime.gl
    gl.bindFramebuffer(gl.FRAMEBUFFER, null)
    gl.viewport(0, 0, this.options.canvas.width, this.options.canvas.height)
    gl.clearColor(0, 0, 0, 0)
    gl.clear(gl.COLOR_BUFFER_BIT)
  }

  /**
   * 释放渲染器内部所有 GPU/CPU 侧资源。
   */
  dispose(): void {
    this.transitionChainAdapter.dispose()
    this.chainAdapter.dispose()
    this.sourceUploader.dispose()
    this.runtime.dispose()
  }

  private getTransitionEdgeTextureId(
    transitionItemId: string,
    edgeKey: 'leftTail' | 'rightHead',
  ): string | null {
    const textureId = `transition-edge:${transitionItemId}:${edgeKey}`
    return this.runtime.textures.get(textureId) ? textureId : null
  }

  private ensureTransitionEdgeTextures(
    transitionItem: UnifiedTimelineItemData<'video'> | UnifiedTimelineItemData<'image'>,
  ): void {
    this.knownTransitionEdgeItemIds.add(transitionItem.id)
    const edgeFrames = transitionItem.runtime.transition?.edgeFrames
    if (!edgeFrames) {
      return
    }

    if (edgeFrames.leftTail) {
      this.sourceUploader.ensureTextureForSource(
        `transition-edge:${transitionItem.id}:leftTail`,
        edgeFrames.leftTail,
      )
    }

    if (edgeFrames.rightHead) {
      this.sourceUploader.ensureTextureForSource(
        `transition-edge:${transitionItem.id}:rightHead`,
        edgeFrames.rightHead,
      )
    }
  }

  private pruneTransitionEdgeTextures(
    timelineItems: UnifiedTimelineItemData<MediaType>[],
  ): void {
    const activeItemIds = new Set<string>()

    for (const item of timelineItems) {
      if (!TimelineItemQueries.supportsClipTransitionOut(item)) {
        continue
      }

      activeItemIds.add(item.id)

      if (!item.runtime.transition?.edgeFrames?.leftTail) {
        this.sourceUploader.removeTexture(`transition-edge:${item.id}:leftTail`)
      }

      if (!item.runtime.transition?.edgeFrames?.rightHead) {
        this.sourceUploader.removeTexture(`transition-edge:${item.id}:rightHead`)
      }
    }

    for (const itemId of this.knownTransitionEdgeItemIds) {
      if (activeItemIds.has(itemId)) {
        continue
      }

      this.sourceUploader.removeTexture(`transition-edge:${itemId}:leftTail`)
      this.sourceUploader.removeTexture(`transition-edge:${itemId}:rightHead`)
      this.knownTransitionEdgeItemIds.delete(itemId)
    }
  }

  private collectActiveTransitions(
    timelineItems: UnifiedTimelineItemData<MediaType>[],
    currentFrame: number,
  ): Array<{
    transitionItem: UnifiedTimelineItemData<'video'> | UnifiedTimelineItemData<'image'>
    rightItem: UnifiedTimelineItemData<'video'> | UnifiedTimelineItemData<'image'>
  }> {
    const activeTransitions: Array<{
      transitionItem: UnifiedTimelineItemData<'video'> | UnifiedTimelineItemData<'image'>
      rightItem: UnifiedTimelineItemData<'video'> | UnifiedTimelineItemData<'image'>
    }> = []

    for (const item of timelineItems) {
      if (!hasEnabledClipTransitionOut(item) || !item.runtime.transition) {
        continue
      }

      const track = this.options.getTrack(item.trackId)
      if (track && !track.isVisible) {
        continue
      }

      const playbackState = resolveClipTransitionPlaybackState(
        item,
        item.runtime.transition,
        currentFrame,
      )
      if (!playbackState) {
        continue
      }

      const liveItem = timelineItems.find((candidate) => candidate.id === playbackState.liveItemId)
      if (!liveItem || !TimelineItemQueries.supportsClipTransitionOut(liveItem)) {
        continue
      }

      const rightItem = timelineItems.find(
        (candidate) => candidate.id === item.runtime.transition?.rightItemId,
      )
      if (!rightItem || !TimelineItemQueries.supportsClipTransitionOut(rightItem)) {
        continue
      }

      if (
        item.runtime.transition.bindingState !== 'bound' ||
        !item.runtime.transition.edgeFrames?.leftTail ||
        !item.runtime.transition.edgeFrames?.rightHead
      ) {
        continue
      }

      activeTransitions.push({
        transitionItem: item,
        rightItem,
      })
    }

    return activeTransitions
  }
}
