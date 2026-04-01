import type { UnifiedTimelineItemData } from '@/core/timelineitem/type'
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
  trackIndexMap: () => Map<string, number>
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
    })
    this.chainAdapter = new TimelineRenderChainAdapter(this.chainBuilder)
  }

  /**
   * 执行一帧完整的时间轴预览渲染。
   */
  render(
    timelineItems: UnifiedTimelineItemData<MediaType>[],
    currentFrame: number,
    bunnyCurFrameMap: Map<string, FrameData>,
  ): void {
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

    // 这里先在 CPU 侧完成时间范围、轨道可见性和素材就绪判断，避免无意义的 texture 上传和 draw call。
    const visibleItems = getVisibleRenderableItems(timelineItems, {
      currentFrame,
      canvasWidth: this.options.canvas.width,
      canvasHeight: this.options.canvas.height,
      bunnyCurFrameMap,
      getTrack: this.options.getTrack,
      getMediaItem: this.options.getMediaItem,
      trackIndexMap: this.options.trackIndexMap(),
    })

    for (const item of visibleItems) {
      this.sourceUploader.ensureTextureForItem(item, bunnyCurFrameMap)
      this.chainAdapter.getChain(item).render(ctx)
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
    this.chainAdapter.dispose()
    this.sourceUploader.dispose()
    this.runtime.dispose()
  }
}
