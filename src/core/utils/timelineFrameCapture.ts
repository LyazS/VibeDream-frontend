import type { UnifiedLibraryAssetData } from '@/core/asset/types'
import { setupTimelineItemBunny } from '@/core/bunnyUtils/timelineItemSetup'
import { RENDERER_FPS } from '@/core/mediabunny/constant'
import type { IClip } from '@/core/mediabunny/IClip'
import type { MediaType, UnifiedMediaItemData } from '@/core/mediaitem/types'
import {
  closeClipTransitionEdgeFrames,
  refreshClipTransitionsForItems,
} from '@/core/timelineitem/features/transition'
import type { UnifiedTimelineItemData } from '@/core/timelineitem/model/timelineItem'
import { TimelineItemQueries } from '@/core/timelineitem/queries'
import { TimelineItemFactory } from '@/core/timelineitem/runtime/factory'
import { applyAnimationToConfig } from '@/core/utils/animationInterpolation'
import { WebGLExportRenderer } from '@/core/utils/WebGLExportRenderer'
import { TransitionEdgeFrameResolver } from '@/core/webgl2/transition/TransitionEdgeFrameResolver'
import type { FrameData } from '@/core/webgl2/types'

export interface TimelineFrameCaptureOptions {
  videoWidth: number
  videoHeight: number
  timelineItems: UnifiedTimelineItemData<MediaType>[]
  tracks: { id: string; isVisible: boolean; isMuted: boolean }[]
  getMediaItem: (id: string) => UnifiedMediaItemData | undefined
  getAsset: (id: string | null) => UnifiedLibraryAssetData | undefined
  frameRate?: number
}

export interface CaptureTimelineFrameOptions {
  mimeType?: string
  quality?: number
}

export class TimelineFrameCaptureSession {
  private canvas: HTMLCanvasElement | null = null
  private webglRenderer: WebGLExportRenderer | null = null
  private clonedTimelineItems: UnifiedTimelineItemData<MediaType>[] = []
  private clipsMap = new Map<string, IClip>()
  private bunnyCurFrameMap = new Map<string, FrameData>()
  private transitionEdgeResolver: TransitionEdgeFrameResolver
  private frameRate: number
  private initialized = false

  constructor(private readonly config: TimelineFrameCaptureOptions) {
    this.frameRate = config.frameRate ?? RENDERER_FPS
    this.transitionEdgeResolver = new TransitionEdgeFrameResolver((mediaItemId: string) =>
      this.config.getMediaItem(mediaItemId),
    )
  }

  async initialize(): Promise<void> {
    if (this.initialized) {
      return
    }

    try {
      this.createCanvas(this.config.videoWidth, this.config.videoHeight)
      this.clonedTimelineItems = await this.cloneAndRebuildTimelineItems(
        this.config.timelineItems,
        this.config.getMediaItem,
      )
      refreshClipTransitionsForItems(this.clonedTimelineItems)
      await this.transitionEdgeResolver.prepareItems(this.clonedTimelineItems)
      this.initialized = true
    } catch (error) {
      await this.dispose()
      throw error
    }
  }

  async captureFrame(
    frameNumber: number,
    options: CaptureTimelineFrameOptions = {},
  ): Promise<Blob> {
    await this.initialize()
    await this.renderFrame(frameNumber)
    return await canvasToBlob(this.getCanvas(), options)
  }

  async captureFrames(
    frameNumbers: number[],
    options: CaptureTimelineFrameOptions = {},
  ): Promise<Blob[]> {
    await this.initialize()

    const results: Blob[] = []
    for (const frameNumber of frameNumbers) {
      await this.renderFrame(frameNumber)
      results.push(await canvasToBlob(this.getCanvas(), options))
    }
    return results
  }

  getCanvas(): HTMLCanvasElement {
    if (!this.canvas) {
      throw new Error('离屏画布尚未初始化')
    }
    return this.canvas
  }

  async dispose(): Promise<void> {
    for (const frameData of this.bunnyCurFrameMap.values()) {
      frameData.videoSample.close()
    }
    this.bunnyCurFrameMap.clear()

    for (const clip of this.clipsMap.values()) {
      await clip.dispose()
    }
    this.clipsMap.clear()

    for (const item of this.clonedTimelineItems) {
      item.runtime.textBitmap?.close()
      item.runtime.textBitmap = undefined
      if (item.runtime.transition?.edgeFrames) {
        closeClipTransitionEdgeFrames(item.runtime.transition.edgeFrames)
        item.runtime.transition.edgeFrames = undefined
        item.runtime.transition.edgeSignature = undefined
      }
    }
    this.clonedTimelineItems = []

    this.webglRenderer?.dispose()
    this.webglRenderer = null
    this.canvas = null
    this.initialized = false
  }

  private createCanvas(width: number, height: number): void {
    this.webglRenderer = new WebGLExportRenderer({
      width,
      height,
      getTrack: (trackId: string) => {
        const track = this.config.tracks.find((item) => item.id === trackId)
        return track
          ? {
              isVisible: track.isVisible,
            }
          : undefined
      },
      getMediaItem: this.config.getMediaItem,
      getAsset: this.config.getAsset,
      trackIndexMap: () => new Map(this.config.tracks.map((track, index) => [track.id, index])),
    })
    this.canvas = this.webglRenderer.canvas
  }

  private async cloneAndRebuildTimelineItems(
    originalItems: UnifiedTimelineItemData<MediaType>[],
    getMediaItem: (id: string) => UnifiedMediaItemData | undefined,
  ): Promise<UnifiedTimelineItemData<MediaType>[]> {
    this.clonedTimelineItems = []
    this.clipsMap = new Map()

    for (const originalItem of originalItems) {
      const clonedItem = TimelineItemFactory.clone(originalItem)

      let mediaItem: UnifiedMediaItemData | undefined
      if (
        TimelineItemQueries.isVideoTimelineItem(clonedItem) ||
        TimelineItemQueries.isAudioTimelineItem(clonedItem) ||
        TimelineItemQueries.isImageTimelineItem(clonedItem)
      ) {
        mediaItem = getMediaItem(clonedItem.mediaItemId)
        if (!mediaItem) {
          throw new Error(`找不到媒体项目: ${clonedItem.mediaItemId}`)
        }
      }

      await setupTimelineItemBunny(clonedItem, mediaItem)

      if (clonedItem.runtime.bunnyClip) {
        this.clipsMap.set(clonedItem.id, clonedItem.runtime.bunnyClip)
      }

      this.clonedTimelineItems.push(clonedItem)
    }

    return this.clonedTimelineItems
  }

  private async renderFrame(frameNumber: number): Promise<void> {
    const frameIn30fps = Math.round(frameNumber * (RENDERER_FPS / this.frameRate))

    await Promise.all(
      this.clonedTimelineItems.map(async (item) => {
        applyAnimationToConfig(item, frameIn30fps)

        if (!TimelineItemQueries.isVideoTimelineItem(item)) {
          return
        }

        const bunnyClip = item.runtime.bunnyClip
        if (!bunnyClip) {
          return
        }

        if (
          frameIn30fps < item.timeRange.timelineStartTime ||
          frameIn30fps >= item.timeRange.timelineEndTime
        ) {
          const oldFrame = this.bunnyCurFrameMap.get(item.id)
          oldFrame?.videoSample.close()
          this.bunnyCurFrameMap.delete(item.id)
          return
        }

        const { video, state } = await bunnyClip.tickN(
          BigInt(frameIn30fps),
          false,
          true,
          0n,
        )

        if (state === 'success' && video) {
          const oldFrame = this.bunnyCurFrameMap.get(item.id)
          oldFrame?.videoSample.close()
          this.bunnyCurFrameMap.set(item.id, {
            frameNumber: frameIn30fps,
            clockwiseRotation: bunnyClip.clockwiseRotation,
            videoSample: video,
          })
          return
        }

        video?.close()
        const oldFrame = this.bunnyCurFrameMap.get(item.id)
        oldFrame?.videoSample.close()
        this.bunnyCurFrameMap.delete(item.id)
      }),
    )

    if (!this.webglRenderer) {
      throw new Error('离屏渲染器未初始化')
    }

    this.webglRenderer.render(this.clonedTimelineItems, frameIn30fps, this.bunnyCurFrameMap)
  }
}

export async function captureTimelineFrames(
  config: TimelineFrameCaptureOptions,
  frameNumbers: number[],
  options: CaptureTimelineFrameOptions = {},
): Promise<Blob[]> {
  const session = new TimelineFrameCaptureSession(config)
  try {
    return await session.captureFrames(frameNumbers, options)
  } finally {
    await session.dispose()
  }
}

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')

  try {
    link.href = url
    link.download = filename
    document.body.appendChild(link)
    link.click()
  } finally {
    document.body.removeChild(link)
    URL.revokeObjectURL(url)
  }
}

async function canvasToBlob(
  canvas: HTMLCanvasElement,
  options: CaptureTimelineFrameOptions,
): Promise<Blob> {
  const mimeType = options.mimeType ?? 'image/png'
  const quality = options.quality ?? 1.0

  return await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) {
        resolve(blob)
        return
      }
      reject(new Error('Canvas 转换为 Blob 失败'))
    }, mimeType, quality)
  })
}
