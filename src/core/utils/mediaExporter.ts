/**
 * 单个素材/时间轴项目导出工具
 * 从 projectExporter.ts 拆分而来
 */

import { QUALITY_MEDIUM } from 'mediabunny'
import type { AudioMediaConfig, UnifiedTimelineItemData, VideoMediaConfig } from '@/core/timelineitem/model/timelineItem'
import { createDefaultTimelineExtraRenderConfig } from '@/core/timelineitem/model/timelineItem'
import type { UnifiedMediaItemData } from '@/core/mediaitem/types'
import { DEFAULT_BLEND_MODE } from '@/core/timelineitem/model/blendMode'
import { RENDERER_FPS } from '@/core/mediabunny/constant'
import { BunnyClip } from '@/core/mediabunny/bunny-clip'
import { ExportManager, type ExportProjectOptions } from './projectExporter'

export type { ExportType } from './projectExporter'

export interface ExportMediaItemOptions {
  mediaItem: UnifiedMediaItemData
  onProgress?: (progress: number) => void
  frameRate?: number
  outputWidth?: number
  outputHeight?: number
}

export interface ExportTimelineItemOptions {
  timelineItem: UnifiedTimelineItemData
  getMediaItem: (id: string | null) => UnifiedMediaItemData | undefined
  onProgress?: (progress: number) => void
  exportType?: 'video' | 'audio'
  frameRate?: number
  outputWidth?: number
  outputHeight?: number
}

function normalizeExportDimension(value?: number): number | undefined {
  if (value === undefined || value === null || !Number.isFinite(value) || value <= 0) {
    return undefined
  }

  return Math.max(1, Math.round(value))
}

function normalizeEvenExportDimension(value?: number): number | undefined {
  const normalized = normalizeExportDimension(value)
  if (normalized === undefined) {
    return undefined
  }

  return normalized % 2 === 0 ? normalized : normalized + 1
}

function resolveExportSize(
  sourceWidth: number,
  sourceHeight: number,
  options?: Pick<ExportMediaItemOptions, 'outputWidth' | 'outputHeight'>,
): { width: number; height: number } {
  const normalizedOutputWidth = normalizeExportDimension(options?.outputWidth)
  const normalizedOutputHeight = normalizeExportDimension(options?.outputHeight)

  if (normalizedOutputWidth && normalizedOutputHeight) {
    return {
      width: normalizedOutputWidth,
      height: normalizedOutputHeight,
    }
  }

  if (normalizedOutputWidth) {
    return {
      width: normalizedOutputWidth,
      height: Math.max(1, Math.round(sourceHeight * (normalizedOutputWidth / sourceWidth))),
    }
  }

  if (normalizedOutputHeight) {
    return {
      width: Math.max(1, Math.round(sourceWidth * (normalizedOutputHeight / sourceHeight))),
      height: normalizedOutputHeight,
    }
  }

  return {
    width: sourceWidth,
    height: sourceHeight,
  }
}

function resolveEvenVideoExportSize(
  sourceWidth: number,
  sourceHeight: number,
  options?: Pick<ExportMediaItemOptions, 'outputWidth' | 'outputHeight'>,
): { width: number; height: number } {
  const size = resolveExportSize(sourceWidth, sourceHeight, options)

  return {
    width: normalizeEvenExportDimension(size.width)!,
    height: normalizeEvenExportDimension(size.height)!,
  }
}

async function exportImageMediaItem(
  mediaItem: UnifiedMediaItemData,
  onProgress?: (progress: number) => void,
  sizeOptions?: Pick<ExportMediaItemOptions, 'outputWidth' | 'outputHeight'>,
): Promise<Blob> {
  const imageClip = mediaItem.runtime.bunny?.imageClip
  if (!imageClip) {
    throw new Error('媒体项目未就绪：imageClip 不存在')
  }

  onProgress?.(20)

  const canvas = document.createElement('canvas')
  const outputSize = resolveExportSize(imageClip.width, imageClip.height, sizeOptions)
  canvas.width = outputSize.width
  canvas.height = outputSize.height
  const ctx = canvas.getContext('2d')!

  ctx.drawImage(imageClip, 0, 0, canvas.width, canvas.height)

  onProgress?.(60)

  const blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) {
        resolve(blob)
      } else {
        reject(new Error('图片转换失败'))
      }
    }, 'image/png')
  })

  onProgress?.(100)

  return blob
}

async function exportVideoMediaItem(
  mediaItem: UnifiedMediaItemData,
  onProgress?: (progress: number) => void,
  frameRate?: number,
  sizeOptions?: Pick<ExportMediaItemOptions, 'outputWidth' | 'outputHeight'>,
): Promise<Blob> {
  if (mediaItem.mediaStatus !== 'ready') {
    throw new Error('媒体项目未就绪')
  }

  const bunnyMedia = mediaItem.runtime.bunny?.bunnyMedia
  if (!bunnyMedia) {
    throw new Error('媒体项目未就绪：bunnyMedia 不存在')
  }
  await bunnyMedia.ready
  const outputSize = resolveEvenVideoExportSize(bunnyMedia.width, bunnyMedia.height, sizeOptions)

  const durationInFrames = Number(bunnyMedia.durationN)
  const baseRenderConfig: VideoMediaConfig = {
    visual: {
      x: 0,
      y: 0,
      width: outputSize.width,
      height: outputSize.height,
      rotation: 0,
      blendIntensity: 1,
      blendMode: DEFAULT_BLEND_MODE,
      proportionalScale: true,
    },
    audio: {
      volume: 1,
      isMuted: false,
    },
  }
  const tempTimelineItem: UnifiedTimelineItemData<'video'> = {
    id: 'temp-export-item',
    mediaType: 'video',
    mediaItemId: mediaItem.id,
    trackId: 'temp-track',
    timelineStatus: 'ready',
    timeRange: {
      timelineStartTime: 0,
      timelineEndTime: durationInFrames,
      clipStartTime: 0,
      clipEndTime: durationInFrames,
    },
    baseRenderConfig,
    exRenderConfig: createDefaultTimelineExtraRenderConfig(),
    runtime: {
      exRenderConfig: createDefaultTimelineExtraRenderConfig(),
      isInitialized: true,
    },
  }

  const exportOptions: ExportProjectOptions = {
    exportType: 'video',
    videoWidth: outputSize.width,
    videoHeight: outputSize.height,
    projectName: 'temp-export',
    timelineItems: [tempTimelineItem],
    tracks: [{ id: 'temp-track', isVisible: true, isMuted: false }],
    getMediaItem: (id: string) => (id === mediaItem.id ? mediaItem : undefined),
    getAsset: () => undefined,
    onProgress: onProgress ? (stage, progress) => onProgress(progress) : undefined,
    videoQuality: QUALITY_MEDIUM,
    audioQuality: QUALITY_MEDIUM,
    frameRate: frameRate,
  }

  const manager = new ExportManager(exportOptions)
  const videoData = await manager.export()

  return new Blob([videoData.buffer as ArrayBuffer], { type: 'video/mp4' })
}

async function exportAudioMediaItem(
  mediaItem: UnifiedMediaItemData,
  onProgress?: (progress: number) => void,
): Promise<Blob> {
  const bunnyMedia = mediaItem.runtime.bunny?.bunnyMedia
  if (!bunnyMedia) {
    throw new Error('媒体项目未就绪：bunnyMedia 不存在')
  }

  const oriFile = bunnyMedia.getOriFile()
  if (!oriFile) {
    throw new Error('无法获取原始音频文件')
  }

  onProgress?.(100)
  return new Blob([oriFile], { type: oriFile.type })
}

export async function exportMediaItem(options: ExportMediaItemOptions): Promise<Blob> {
  const { mediaItem, onProgress, frameRate, outputWidth, outputHeight } = options
  const sizeOptions =
    mediaItem.mediaType === 'video'
      ? {
          outputWidth: normalizeEvenExportDimension(outputWidth),
          outputHeight: normalizeEvenExportDimension(outputHeight),
        }
      : { outputWidth, outputHeight }

  if (mediaItem.mediaType === 'image') {
    return await exportImageMediaItem(mediaItem, onProgress, sizeOptions)
  }

  if (mediaItem.mediaType === 'video') {
    return await exportVideoMediaItem(mediaItem, onProgress, frameRate, sizeOptions)
  }

  if (mediaItem.mediaType === 'audio') {
    return await exportAudioMediaItem(mediaItem, onProgress)
  }

  throw new Error(`不支持导出 ${mediaItem.mediaType} 类型的媒体项目`)
}

async function exportImageTimelineItem(
  timelineItem: UnifiedTimelineItemData,
  getMediaItem: (id: string | null) => UnifiedMediaItemData | undefined,
  onProgress?: (progress: number) => void,
): Promise<Blob> {
  const mediaItem = getMediaItem(timelineItem.mediaItemId)
  if (!mediaItem) {
    throw new Error(`找不到媒体项目: ${timelineItem.mediaItemId}`)
  }

  return await exportImageMediaItem(mediaItem, onProgress)
}

async function exportVideoTimelineItem(
  timelineItem: UnifiedTimelineItemData,
  getMediaItem: (id: string | null) => UnifiedMediaItemData | undefined,
  onProgress?: (progress: number) => void,
  frameRate?: number,
  sizeOptions?: Pick<ExportMediaItemOptions, 'outputWidth' | 'outputHeight'>,
): Promise<Blob> {
  const mediaItem = getMediaItem(timelineItem.mediaItemId)
  if (!mediaItem) {
    throw new Error(`找不到媒体项目: ${timelineItem.mediaItemId}`)
  }

  if (mediaItem.mediaStatus !== 'ready') {
    throw new Error('媒体项目未就绪')
  }

  const bunnyMedia = mediaItem.runtime.bunny?.bunnyMedia
  if (!bunnyMedia) {
    throw new Error('媒体项目未就绪：bunnyMedia 不存在')
  }
  await bunnyMedia.ready

  const { width: outputWidth, height: outputHeight } = resolveEvenVideoExportSize(
    bunnyMedia.width,
    bunnyMedia.height,
    sizeOptions,
  )

  const baseRenderConfig: VideoMediaConfig = {
    visual: {
      x: 0,
      y: 0,
      width: outputWidth,
      height: outputHeight,
      rotation: 0,
      blendIntensity: 1,
      blendMode: DEFAULT_BLEND_MODE,
      proportionalScale: true,
    },
    audio: {
      volume: 1,
      isMuted: false,
    },
  }
  const cleanTimelineItem: UnifiedTimelineItemData<'video'> = {
    id: 'temp-export-item',
    mediaType: 'video',
    mediaItemId: mediaItem.id,
    trackId: 'temp-track',
    timelineStatus: 'ready',
    timeRange: {
      timelineStartTime: 0,
      timelineEndTime:
        timelineItem.timeRange.timelineEndTime - timelineItem.timeRange.timelineStartTime,
      clipStartTime: timelineItem.timeRange.clipStartTime,
      clipEndTime: timelineItem.timeRange.clipEndTime,
    },
    baseRenderConfig,
    exRenderConfig: createDefaultTimelineExtraRenderConfig(),
    runtime: {
      exRenderConfig: createDefaultTimelineExtraRenderConfig(),
      isInitialized: true,
    },
  }

  const exportOptions: ExportProjectOptions = {
    exportType: 'video',
    videoWidth: outputWidth,
    videoHeight: outputHeight,
    projectName: 'temp-export',
    timelineItems: [cleanTimelineItem],
    tracks: [{ id: 'temp-track', isVisible: true, isMuted: false }],
    getMediaItem: (id: string) => (id === mediaItem.id ? mediaItem : undefined),
    getAsset: () => undefined,
    onProgress: onProgress ? (stage, progress) => onProgress(progress) : undefined,
    videoQuality: QUALITY_MEDIUM,
    audioQuality: QUALITY_MEDIUM,
    frameRate: frameRate,
  }

  const manager = new ExportManager(exportOptions)
  const videoData = await manager.export()

  return new Blob([videoData.buffer as ArrayBuffer], { type: 'video/mp4' })
}

async function exportAudioTimelineItem(
  timelineItem: UnifiedTimelineItemData<'video' | 'audio'>,
  getMediaItem: (id: string) => UnifiedMediaItemData | undefined,
  onProgress?: (progress: number) => void,
): Promise<Blob> {
  const mediaItem = getMediaItem(timelineItem.mediaItemId)
  if (!mediaItem) {
    throw new Error(`找不到媒体项目: ${timelineItem.mediaItemId}`)
  }

  if (mediaItem.mediaStatus !== 'ready') {
    throw new Error('媒体项目未就绪')
  }

  const bunnyMedia = mediaItem.runtime.bunny?.bunnyMedia
  if (!bunnyMedia) {
    throw new Error('媒体项目未就绪：bunnyMedia 不存在')
  }
  await bunnyMedia.ready

  const baseRenderConfig: VideoMediaConfig | AudioMediaConfig =
    timelineItem.mediaType === 'video'
      ? {
          visual: {
            x: 0,
            y: 0,
            width: bunnyMedia.width,
            height: bunnyMedia.height,
            rotation: 0,
            blendIntensity: 1,
            blendMode: DEFAULT_BLEND_MODE,
            proportionalScale: true,
          },
          audio: {
            volume: 1,
            isMuted: false,
          },
        }
      : {
          audio: {
            volume: 1,
            isMuted: false,
          },
        }
  const cleanTimelineItem: UnifiedTimelineItemData<'video' | 'audio'> = {
    ...timelineItem,
    id: 'temp-export-item',
    trackId: 'temp-track',
    timelineStatus: 'ready',
    timeRange: {
      timelineStartTime: 0,
      timelineEndTime:
        timelineItem.timeRange.timelineEndTime - timelineItem.timeRange.timelineStartTime,
      clipStartTime: timelineItem.timeRange.clipStartTime,
      clipEndTime: timelineItem.timeRange.clipEndTime,
    },
    baseRenderConfig,
    exRenderConfig: createDefaultTimelineExtraRenderConfig(),
    runtime: {
      exRenderConfig: createDefaultTimelineExtraRenderConfig(),
      isInitialized: true,
    },
  }

  const exportOptions: ExportProjectOptions = {
    exportType: 'audio',
    videoWidth: timelineItem.mediaType === 'video' ? bunnyMedia.width : 1920,
    videoHeight: timelineItem.mediaType === 'video' ? bunnyMedia.height : 1080,
    projectName: 'temp-export',
    timelineItems: [cleanTimelineItem],
    tracks: [{ id: 'temp-track', isVisible: true, isMuted: false }],
    getMediaItem: (id: string) => (id === mediaItem.id ? mediaItem : undefined),
    getAsset: () => undefined,
    onProgress: onProgress ? (stage, progress) => onProgress(progress) : undefined,
    videoQuality: QUALITY_MEDIUM,
    audioQuality: QUALITY_MEDIUM,
    frameRate: 30,
  }

  const manager = new ExportManager(exportOptions)
  const audioData = await manager.export()

  return new Blob([audioData.buffer as ArrayBuffer], { type: 'audio/mpeg' })
}

export async function exportTimelineItem(options: ExportTimelineItemOptions): Promise<Blob> {
  const { timelineItem, onProgress, getMediaItem, frameRate, exportType, outputWidth, outputHeight } = options

  if (timelineItem.mediaType === 'image') {
    return await exportImageTimelineItem(timelineItem, getMediaItem, onProgress)
  }

  if (timelineItem.mediaType === 'video') {
    if (exportType === 'audio') {
      return await exportAudioTimelineItem(
        timelineItem as UnifiedTimelineItemData<'video'>,
        getMediaItem,
        onProgress,
      )
    }
    return await exportVideoTimelineItem(
      timelineItem,
      getMediaItem,
      onProgress,
      frameRate,
      {
        outputWidth,
        outputHeight,
      },
    )
  }

  if (timelineItem.mediaType === 'audio') {
    return await exportAudioTimelineItem(
      timelineItem as UnifiedTimelineItemData<'audio'>,
      getMediaItem,
      onProgress,
    )
  }

  throw new Error(`不支持导出 ${timelineItem.mediaType} 类型的时间轴项目`)
}

export interface ExportVideoFramesOptions {
  timelineItem: UnifiedTimelineItemData<'video'>
  getMediaItem: (id: string | null) => UnifiedMediaItemData | undefined
  timestampsMs: number[]
  outputWidth?: number
  outputHeight?: number
  format?: 'png' | 'jpeg'
}

export async function exportVideoFrames(options: ExportVideoFramesOptions): Promise<Blob[]> {
  const { timelineItem, getMediaItem, timestampsMs, outputWidth, outputHeight, format = 'png' } = options

  const mediaItem = getMediaItem(timelineItem.mediaItemId)
  if (!mediaItem || mediaItem.mediaType !== 'video') {
    throw new Error(`找不到视频素材: ${timelineItem.mediaItemId}`)
  }

  const bunnyMedia = mediaItem.runtime.bunny?.bunnyMedia
  if (!bunnyMedia) {
    throw new Error('媒体项目未就绪：bunnyMedia 不存在')
  }
  await bunnyMedia.ready

  const sourceWidth = bunnyMedia.width
  const sourceHeight = bunnyMedia.height
  let targetWidth = outputWidth
  let targetHeight = outputHeight

  if (!targetWidth && !targetHeight) {
    const maxSide = Math.max(sourceWidth, sourceHeight)
    if (maxSide > 480) {
      const scale = 480 / maxSide
      targetWidth = Math.max(2, Math.round(sourceWidth * scale))
      targetHeight = Math.max(2, Math.round(sourceHeight * scale))
    } else {
      targetWidth = sourceWidth
      targetHeight = sourceHeight
    }
  }

  const clipStartFrame = timelineItem.timeRange.clipStartTime
  const mimeType = format === 'jpeg' ? 'image/jpeg' : 'image/png'
  const quality = format === 'jpeg' ? 0.85 : undefined

  const clip = new BunnyClip(bunnyMedia)
  try {
    const blobs: Blob[] = []

    for (const msOffset of timestampsMs) {
      const absoluteFrame = clipStartFrame + Math.round((msOffset / 1000) * RENDERER_FPS)
      const result = await clip.getSampleN(BigInt(absoluteFrame))

      if (result.state !== 'success' || !result.video) {
        throw new Error(`无法获取帧: offset=${msOffset}ms frame=${absoluteFrame}`)
      }

      const videoFrame = result.video.toVideoFrame()
      result.video.close()

      const canvas = document.createElement('canvas')
      canvas.width = targetWidth ?? sourceWidth
      canvas.height = targetHeight ?? sourceHeight
      const ctx = canvas.getContext('2d')!
      ctx.drawImage(videoFrame, 0, 0, canvas.width, canvas.height)
      videoFrame.close()

      const blob = await new Promise<Blob>((resolve, reject) => {
        canvas.toBlob(
          (b) => {
            if (b) resolve(b)
            else reject(new Error('帧转换失败'))
          },
          mimeType,
          quality,
        )
      })

      blobs.push(blob)
    }

    return blobs
  } finally {
    await clip.dispose()
  }
}
