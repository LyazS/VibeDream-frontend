import type { UnifiedTimelineItemData } from '@/core/timelineitem/model/timelineItem'
import type { MediaType, UnifiedMediaItemData } from '@/core/mediaitem/types'
import { WebGL2Runtime } from '@/core/webgl2/runtime/WebGL2Runtime'
import { ClearMainPass } from '@/core/webgl2/passes/ClearMainPass'
import { PresentPass } from '@/core/webgl2/passes/PresentPass'
import { getVisibleRenderableItems } from '@/core/webgl2/utils/RenderItemVisibility'
import { ChainBuilder } from '@/core/webgl2/chains/ChainBuilder'
import { TimelineRenderChainAdapter } from '@/core/webgl2/chains/TimelineRenderChainAdapter'
import { SourceTextureUploader } from '@/core/webgl2/renderer/SourceTextureUploader'
import type { RenderPassContext } from '@/core/webgl2/renderchain/RenderPassContext'
import type { FrameData } from '@/core/webgl2/types'
import { TimelineItemQueries } from '@/core/timelineitem/queries'

interface TimelineWebGLRendererOptions {
  canvas: HTMLCanvasElement
  getTrack: (trackId: string) => { isVisible: boolean } | undefined
  getMediaItem: (mediaItemId: string) => UnifiedMediaItemData | undefined
  trackIndexMap: () => Map<string, number>
  getSelectedTimelineItemId?: () => string | null
}

export class TimelineWebGLRenderer {
  private readonly runtime: WebGL2Runtime
  private readonly clearPass: ClearMainPass
  private readonly presentPass: PresentPass
  private readonly sourceUploader: SourceTextureUploader
  private readonly chainAdapter: TimelineRenderChainAdapter

  constructor(private readonly options: TimelineWebGLRendererOptions) {
    this.runtime = new WebGL2Runtime(options.canvas)
    this.clearPass = new ClearMainPass()
    this.presentPass = new PresentPass(this.runtime.programs)
    this.sourceUploader = new SourceTextureUploader(this.runtime, options.getMediaItem)
    const chainBuilder = new ChainBuilder({
      programs: this.runtime.programs,
      targets: this.runtime.targets,
      getSourceTextureId: (itemId) => this.sourceUploader.getTextureIdForItem(itemId),
      getMediaItem: options.getMediaItem,
    })
    this.chainAdapter = new TimelineRenderChainAdapter(chainBuilder)
  }

  render(
    timelineItems: UnifiedTimelineItemData<MediaType>[],
    currentFrame: number,
    bunnyCurFrameMap: Map<string, FrameData>,
  ): void {
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
    const selectedBoundaryItem = selectedTimelineItemId
      ? timelineItems.find(
          (item) =>
            item.id === selectedTimelineItemId &&
            currentFrame === item.timeRange.timelineEndTime,
        ) ?? null
      : null
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

    const renderQueue = visibleItems
      .filter(
        (item) =>
          TimelineItemQueries.isVideoTimelineItem(item) ||
          TimelineItemQueries.isImageTimelineItem(item),
      )
      .sort((left, right) => {
        const leftIndex = this.options.trackIndexMap().get(left.trackId) ?? -Infinity
        const rightIndex = this.options.trackIndexMap().get(right.trackId) ?? -Infinity
        return leftIndex - rightIndex
      })

    for (const item of renderQueue) {
      this.sourceUploader.ensureTextureForItem(item, bunnyCurFrameMap)
      this.chainAdapter.getChain(item).render(ctx)
    }

    this.presentPass.render(ctx)
  }

  prepareRenderChains(timelineItems: UnifiedTimelineItemData<MediaType>[]): void {
    for (const item of timelineItems) {
      if (
        TimelineItemQueries.isVideoTimelineItem(item) ||
        TimelineItemQueries.isImageTimelineItem(item)
      ) {
        this.chainAdapter.prepareChain(item)
      }
    }
  }

  clear(): void {
    const gl = this.runtime.gl
    gl.bindFramebuffer(gl.FRAMEBUFFER, null)
    gl.viewport(0, 0, this.options.canvas.width, this.options.canvas.height)
    gl.clearColor(0, 0, 0, 0)
    gl.clear(gl.COLOR_BUFFER_BIT)
  }

  dispose(): void {
    this.chainAdapter.dispose()
    this.sourceUploader.dispose()
    this.runtime.dispose()
  }
}
