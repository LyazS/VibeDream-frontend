import { cloneDeep } from 'lodash'
import { abortable } from './abortable'
import { setupTimelineItemBunny } from '@/core/bunnyUtils/timelineItemSetup'
import { RENDERER_FPS } from '@/core/mediabunny/constant'
import type { IClip } from '@/core/mediabunny/IClip'
import type { MediaType, UnifiedMediaItemData } from '@/core/mediaitem/types'
import type { UnifiedTimelineItemData } from '@/core/timelineitem/model/timelineItem'
import { TimelineItemQueries } from '@/core/timelineitem/queries'
import { TimelineItemFactory } from '@/core/timelineitem/runtime/factory'
import { applyAnimationToConfig } from '@/core/utils/animationInterpolation'
import { WebGLExportRenderer } from '@/core/utils/WebGLExportRenderer'
import { VideoFrameMap } from '@/core/mediabunny/VideoFrameMap'

export interface TimelineFrameCaptureOptions {
  videoWidth: number
  videoHeight: number
  timelineItems: UnifiedTimelineItemData<MediaType>[]
  tracks: { id: string; isVisible: boolean; isMuted: boolean }[]
  getMediaItem: (id: string) => UnifiedMediaItemData | undefined
  signal?: AbortSignal
  /** 快照缺少解码资源时补齐运行时资源，不重新读取可编辑元数据。 */
  prepareMedia?: (id: string) => Promise<unknown>
  timeoutMs?: number
  frameRate?: number
}

export interface CaptureTimelineFrameOptions {
  mimeType?: string
  quality?: number
  signal?: AbortSignal
  prepareMedia?: (id: string) => Promise<unknown>
  timeoutMs?: number
}

/** 在固定工程快照上离屏渲染多帧，独立管理截帧资源，不改变编辑器播放状态。 */
export class TimelineFrameCaptureSession {
  private canvas: HTMLCanvasElement | null = null
  private webglRenderer: WebGLExportRenderer | null = null
  private clonedTimelineItems: UnifiedTimelineItemData<MediaType>[] = []
  private clipsMap = new Map<string, IClip>()
  private bunnyCurFrameMap = new VideoFrameMap()
  private frameRate: number
  private initialized = false
  private disposed = false
  private readonly config: TimelineFrameCaptureOptions
  private readonly signal: AbortSignal
  private readonly mediaSources = new Map<string, UnifiedMediaItemData>()
  private readonly tracksById = new Map<string, TimelineFrameCaptureOptions['tracks'][number]>()

  constructor(config: TimelineFrameCaptureOptions) {
    // 首次异步等待前复制全部可编辑数据；素材解码器和位图仅借用，仍由素材库持有。
    const items = config.timelineItems.map((item) => TimelineItemFactory.clone(item))
    const media = new Map<string, UnifiedMediaItemData>()
    const snapshotMedia = (id: string, original: UnifiedMediaItemData): UnifiedMediaItemData => {
      let captured = media.get(id)
      if (!captured) {
        captured = {
          ...cloneDeep({ ...original, runtime: {} }),
          runtime: { bunny: { ...original.runtime?.bunny } },
        }
        this.mediaSources.set(id, original)
        media.set(id, captured)
      }
      return captured
    }
    for (const item of items) {
      if (!item.mediaItemId || media.has(item.mediaItemId)) continue
      const original = config.getMediaItem(item.mediaItemId)
      if (original) snapshotMedia(item.mediaItemId, original)
    }
    this.config = {
      ...config,
      timelineItems: items,
      tracks: cloneDeep(config.tracks),
      getMediaItem: (id) => media.get(id),
    }
    for (const track of this.config.tracks) {
      if (!this.tracksById.has(track.id)) this.tracksById.set(track.id, track)
    }
    this.signal = AbortSignal.any([
      ...(config.signal ? [config.signal] : []),
      AbortSignal.timeout(config.timeoutMs ?? 60_000),
    ])
    this.frameRate = config.frameRate ?? RENDERER_FPS
  }

  private check() {
    this.signal.throwIfAborted()
    if (this.disposed) throw new DOMException('截帧会话已释放', 'AbortError')
  }

  private isTrackVisible(trackId: string): boolean {
    return this.tracksById.get(trackId)?.isVisible !== false
  }

  async initialize(): Promise<void> {
    this.check()
    if (this.initialized) {
      return
    }

    try {
      this.createCanvas(this.config.videoWidth, this.config.videoHeight)
      this.clonedTimelineItems = await this.cloneAndRebuildTimelineItems(
        this.config.timelineItems,
        this.config.getMediaItem,
      )
      this.check()
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
    await this.renderToCanvas(frameNumber)
    return await abortable(canvasToBlob(this.getCanvas(), options), this.signal)
  }

  /** 返回复用的离屏画布；调用者须在渲染下一帧前完成编码或复制。 */
  async renderToCanvas(frameNumber: number): Promise<HTMLCanvasElement> {
    this.check()
    if (!Number.isInteger(frameNumber) || frameNumber < 0) throw new Error('无效截图帧数')
    await this.initialize()
    await this.renderFrame(frameNumber)
    this.check()
    return this.getCanvas()
  }

  async captureFrames(
    frameNumbers: number[],
    options: CaptureTimelineFrameOptions = {},
  ): Promise<Blob[]> {
    await this.initialize()

    const results: Blob[] = []
    for (const frameNumber of frameNumbers) {
      await this.renderToCanvas(frameNumber)
      results.push(await abortable(canvasToBlob(this.getCanvas(), options), this.signal))
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
    this.disposed = true
    this.bunnyCurFrameMap.clear()

    const clips = [...this.clipsMap.values()]
    this.clipsMap.clear()

    this.clonedTimelineItems = []

    this.webglRenderer?.dispose()
    this.webglRenderer = null
    if (this.canvas) this.canvas.width = this.canvas.height = 0
    this.canvas = null
    this.initialized = false
    // 原生迭代器的 return() 可能等待解码器；先释放当前画面资源，再接收异步清理结果。
    // 调用已取消时立即结束等待，避免解码器清理拖住工具退出。
    await abortable(Promise.allSettled(clips.map((clip) => clip.dispose())), this.signal).catch(
      () => {},
    )
  }

  private createCanvas(width: number, height: number): void {
    this.webglRenderer = new WebGLExportRenderer({
      width,
      height,
      getTrack: (trackId: string) => {
        const track = this.tracksById.get(trackId)
        return track
          ? {
              isVisible: track.isVisible,
            }
          : undefined
      },
      getMediaItem: this.config.getMediaItem,
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
      this.check()
      const clonedItem = originalItem
      this.clonedTimelineItems.push(clonedItem)
      if (clonedItem.mediaType === 'audio' || !this.isTrackVisible(clonedItem.trackId)) continue

      let mediaItem: UnifiedMediaItemData | undefined
      if (
        TimelineItemQueries.isVideoTimelineItem(clonedItem) ||
        TimelineItemQueries.isImageTimelineItem(clonedItem)
      ) {
        mediaItem = getMediaItem(clonedItem.mediaItemId)
        if (!mediaItem) {
          throw new Error(`找不到媒体项目: ${clonedItem.mediaItemId}`)
        }
      }

      const hasResource =
        clonedItem.mediaType === 'image'
          ? mediaItem?.runtime.bunny?.imageClip
          : mediaItem?.runtime.bunny?.bunnyMedia
      if (mediaItem && !hasResource && this.config.prepareMedia) {
        await abortable(this.config.prepareMedia(mediaItem.id), this.signal)
        this.check()
        // 准备完成后只补充解码资源，素材名称、配置等可编辑元数据仍使用初始快照。
        const source = this.mediaSources.get(clonedItem.mediaItemId!)
        mediaItem.runtime.bunny = { ...source?.runtime.bunny }
      }
      await abortable(setupTimelineItemBunny(clonedItem, mediaItem), this.signal, () => {
        void clonedItem.runtime.bunnyClip?.dispose()
      })
      this.check()

      if (clonedItem.runtime.bunnyClip) {
        this.clipsMap.set(clonedItem.id, clonedItem.runtime.bunnyClip)
      }
    }

    return this.clonedTimelineItems
  }

  private async renderFrame(frameNumber: number): Promise<void> {
    const frameIn30fps = Math.round(frameNumber * (RENDERER_FPS / this.frameRate))

    this.check()
    const rendered = await Promise.allSettled(
      this.clonedTimelineItems.map(async (item) => {
        this.check()
        applyAnimationToConfig(item, frameIn30fps)
        if (!this.isTrackVisible(item.trackId) || !TimelineItemQueries.isVideoTimelineItem(item)) {
          return
        }

        if (
          frameIn30fps < item.timeRange.timelineStartTime ||
          frameIn30fps >= item.timeRange.timelineEndTime
        ) {
          this.bunnyCurFrameMap.delete(item.id)
          return
        }

        const bunnyClip = item.runtime.bunnyClip
        if (!bunnyClip) throw new Error(`frame_unavailable：视频解码器不可用 ${item.id}`)
        const { video, state } = await abortable(
          bunnyClip.tickN(BigInt(frameIn30fps), false, true, 0n),
          this.signal,
          (late) => late.video?.close(),
        )
        if (this.signal.aborted || this.disposed) {
          video?.close()
          this.check()
        }

        if (state === 'success' && video) {
          this.bunnyCurFrameMap.set(item.id, {
            timeRange: { ...item.timeRange },
            frameNumber: frameIn30fps,
            clockwiseRotation: bunnyClip.clockwiseRotation,
            videoSample: video,
          })
          return
        }

        video?.close()
        this.bunnyCurFrameMap.delete(item.id)
        throw new Error(`frame_unavailable：必要视频帧不可用 ${item.id}`)
      }),
    )

    // 等待各片段完成以便统一回收资源；必要画面解码失败时不能输出残缺合成图。
    const failed = rendered.find((result) => result.status === 'rejected')
    if (failed?.status === 'rejected') throw failed.reason
    this.check()
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
  const session = new TimelineFrameCaptureSession({
    ...config,
    signal: options.signal ?? config.signal,
    timeoutMs: options.timeoutMs ?? config.timeoutMs,
    prepareMedia: options.prepareMedia ?? config.prepareMedia,
  })
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
    canvas.toBlob(
      (blob) => {
        if (blob) {
          resolve(blob)
          return
        }
        reject(new Error('Canvas 转换为 Blob 失败'))
      },
      mimeType,
      quality,
    )
  })
}
