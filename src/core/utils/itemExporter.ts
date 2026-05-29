/**
 * 单项导出工具
 * 提供单个媒体项目和时间轴项目的导出功能
 * 视频/音频转码通过 Web Worker 在后台线程执行，避免阻塞主线程
 */

import { RENDERER_FPS } from '@/core/mediabunny/constant'
import type { UnifiedTimelineItemData } from '@/core/timelineitem/type'
import type { UnifiedMediaItemData } from '@/core/mediaitem/types'
import ItemExporterWorker from './itemExporter.worker.ts?worker'

const DEBUG_EXPORT = false

export type ExportType = 'video' | 'audio'

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
  exportType?: ExportType
  frameRate?: number
  outputWidth?: number
  outputHeight?: number
}

type ExportWorkerConfig =
  | { task: 'video-media'; file: File; width: number; height: number; frameRate?: number }
  | {
      task: 'video-timeline'
      file: File
      width: number
      height: number
      frameRate?: number
      trimStart: number
      trimEnd: number
    }
  | { task: 'audio-timeline'; file: File; trimStart: number; trimEnd: number }

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

function runExportWorker(
  config: ExportWorkerConfig,
  onProgress?: (progress: number) => void,
): Promise<Blob> {
  return new Promise<Blob>((resolve, reject) => {
    const worker = new ItemExporterWorker()

    worker.onmessage = (e: MessageEvent) => {
      const { type } = e.data

      if (type === 'progress') {
        onProgress?.(e.data.progress)
      } else if (type === 'done') {
        worker.terminate()
        const { buffer, mimeType } = e.data
        resolve(new Blob([buffer], { type: mimeType }))
      } else if (type === 'error') {
        worker.terminate()
        reject(new Error(e.data.message))
      }
    }

    worker.onerror = (e: ErrorEvent) => {
      worker.terminate()
      reject(new Error(e.message || '导出 Worker 执行出错'))
    }

    worker.postMessage({ type: 'export', config })
  })
}

/**
 * 导出图片媒体项目为 PNG Blob（主线程执行，依赖 DOM）
 */
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

/**
 * 导出视频媒体项目为 MP4 Blob（通过 Worker 执行转码）
 */
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

  const outputSize = resolveExportSize(bunnyMedia.width, bunnyMedia.height, sizeOptions)
  const file = bunnyMedia.getOriFile()

  if (DEBUG_EXPORT) console.log('[exportVideoMediaItem] dispatching to Worker')

  return runExportWorker(
    {
      task: 'video-media',
      file,
      width: outputSize.width,
      height: outputSize.height,
      frameRate,
    },
    onProgress,
  )
}

/**
 * 导出音频媒体项目为 Blob（直接返回原始文件，主线程执行）
 */
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

/**
 * 导出单个媒体项目为 Blob（使用原始尺寸）
 */
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

/**
 * 导出图片时间轴项目为 PNG Blob（主线程执行，依赖 DOM）
 */
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

/**
 * 导出视频时间轴项目为 MP4 Blob（通过 Worker 执行转码 + trim 裁剪）
 */
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

  const outputWidth = normalizeEvenExportDimension(sizeOptions?.outputWidth) ?? bunnyMedia.width
  const outputHeight = normalizeEvenExportDimension(sizeOptions?.outputHeight) ?? bunnyMedia.height

  const trimStart = timelineItem.timeRange.clipStartTime / RENDERER_FPS
  const trimEnd = timelineItem.timeRange.clipEndTime / RENDERER_FPS

  const file = bunnyMedia.getOriFile()

  if (DEBUG_EXPORT) console.log(`[exportVideoTimelineItem] dispatching to Worker, trim: ${trimStart}s ~ ${trimEnd}s`)

  return runExportWorker(
    {
      task: 'video-timeline',
      file,
      width: outputWidth,
      height: outputHeight,
      frameRate,
      trimStart,
      trimEnd,
    },
    onProgress,
  )
}

/**
 * 导出视频/音频时间轴项目为音频 MP3 Blob（通过 Worker 执行转码 + trim 裁剪）
 */
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

  const trimStart = timelineItem.timeRange.clipStartTime / RENDERER_FPS
  const trimEnd = timelineItem.timeRange.clipEndTime / RENDERER_FPS

  const file = bunnyMedia.getOriFile()

  if (DEBUG_EXPORT) console.log(`[exportAudioTimelineItem] dispatching to Worker, trim: ${trimStart}s ~ ${trimEnd}s`)

  return runExportWorker(
    {
      task: 'audio-timeline',
      file,
      trimStart,
      trimEnd,
    },
    onProgress,
  )
}

/**
 * 导出单个时间轴项目为 Blob（使用原始尺寸）
 */
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
