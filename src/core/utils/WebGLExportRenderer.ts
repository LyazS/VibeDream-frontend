import type { UnifiedLibraryAssetData } from '@/core/asset/types'
import type { UnifiedMediaItemData } from '@/core/mediaitem/types'
import type { FrameData } from '@/core/webgl2/types'
import { TimelineWebGLRenderer } from '@/core/webgl2/renderer/TimelineWebGLRenderer'
import type { UnifiedTimelineItemData } from '@/core/timelineitem/type'
import type { MediaType } from '@/core/mediaitem/types'

interface WebGLExportRendererOptions {
  width: number
  height: number
  getTrack: (trackId: string) => { isVisible: boolean } | undefined
  getMediaItem: (mediaItemId: string) => UnifiedMediaItemData | undefined
  getAsset: (assetId: string | null) => UnifiedLibraryAssetData | undefined
  trackIndexMap: () => Map<string, number>
}

/**
 * 导出专用的 WebGL 渲染封装。
 *
 * 负责：
 * - 创建离屏 canvas
 * - 复用 TimelineWebGLRenderer 输出每一帧
 * - 为 CanvasSource 提供可编码的画布
 */
export class WebGLExportRenderer {
  readonly canvas: HTMLCanvasElement
  private readonly renderer: TimelineWebGLRenderer

  constructor(options: WebGLExportRendererOptions) {
    this.canvas = document.createElement('canvas')
    this.canvas.width = options.width
    this.canvas.height = options.height

    this.renderer = new TimelineWebGLRenderer({
      canvas: this.canvas,
      getTrack: options.getTrack,
      getMediaItem: options.getMediaItem,
      getAsset: options.getAsset,
      trackIndexMap: options.trackIndexMap,
    })
  }

  render(
    timelineItems: UnifiedTimelineItemData<MediaType>[],
    currentFrame: number,
    bunnyCurFrameMap: Map<string, FrameData>,
  ): void {
    this.renderer.render(timelineItems, currentFrame, bunnyCurFrameMap)
  }

  dispose(): void {
    this.renderer.dispose()
  }
}
