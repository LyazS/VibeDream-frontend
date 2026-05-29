/**
 * 单项导出工具
 * 提供单个媒体项目和时间轴项目的导出功能
 */

import {
  QUALITY_MEDIUM,
  Conversion,
  Input,
  Output,
  Mp4OutputFormat,
  Mp3OutputFormat,
  BufferTarget,
  BlobSource,
  ALL_FORMATS,
} from 'mediabunny'
import { RENDERER_FPS } from '@/core/mediabunny/constant'
import type { UnifiedTimelineItemData } from '@/core/timelineitem/type'
import type { UnifiedMediaItemData } from '@/core/mediaitem/types'

/** 导出调试日志开关，默认关闭 */
const DEBUG_EXPORT = false

/**
 * 导出类型
 */
export type ExportType = 'video' | 'audio'

/**
 * 导出单个媒体项目参数
 */
export interface ExportMediaItemOptions {
  /** 媒体项目数据 */
  mediaItem: UnifiedMediaItemData
  /** 进度更新回调（可选） */
  onProgress?: (progress: number) => void
  /** 导出帧率（可选，默认 30fps，仅视频有效） */
  frameRate?: number
  /** 自定义导出宽度（可选） */
  outputWidth?: number
  /** 自定义导出高度（可选） */
  outputHeight?: number
}

/**
 * 导出单个时间轴项目参数
 */
export interface ExportTimelineItemOptions {
  /** 时间轴项目数据 */
  timelineItem: UnifiedTimelineItemData
  /** 获取媒体项目的函数 */
  getMediaItem: (id: string | null) => UnifiedMediaItemData | undefined
  /** 进度更新回调（可选） */
  onProgress?: (progress: number) => void
  /** 导出类型（可选，仅视频时间轴项目支持音频导出） */
  exportType?: ExportType
  /** 导出帧率（可选，默认 30fps，仅视频有效） */
  frameRate?: number
  /** 自定义导出宽度（可选，仅视频有效） */
  outputWidth?: number
  /** 自定义导出高度（可选，仅视频有效） */
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

/**
 * 导出图片媒体项目为 PNG Blob
 */
async function exportImageMediaItem(
  mediaItem: UnifiedMediaItemData,
  onProgress?: (progress: number) => void,
  sizeOptions?: Pick<ExportMediaItemOptions, 'outputWidth' | 'outputHeight'>,
): Promise<Blob> {
  // 1. 验证 imageClip 存在
  const imageClip = mediaItem.runtime.bunny?.imageClip
  if (!imageClip) {
    throw new Error('媒体项目未就绪：imageClip 不存在')
  }

  onProgress?.(20)

  // 2. 创建临时 Canvas（仅用于格式转换）
  const canvas = document.createElement('canvas')
  const outputSize = resolveExportSize(imageClip.width, imageClip.height, sizeOptions)
  canvas.width = outputSize.width
  canvas.height = outputSize.height
  const ctx = canvas.getContext('2d')!

  // 3. 绘制图片（无任何变换，保持原样）
  ctx.drawImage(imageClip, 0, 0, canvas.width, canvas.height)

  onProgress?.(60)

  // 4. 转换为 PNG Blob
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
 * 导出视频媒体项目为 MP4 Blob（使用 Conversion 直接转码）
 */
async function exportVideoMediaItem(
  mediaItem: UnifiedMediaItemData,
  onProgress?: (progress: number) => void,
  frameRate?: number,
  sizeOptions?: Pick<ExportMediaItemOptions, 'outputWidth' | 'outputHeight'>,
): Promise<Blob> {
  // 1. 验证媒体项目状态
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

  // 2. 使用 Conversion 直接转码
  const conversion = await Conversion.init({
    input: new Input({ source: new BlobSource(file), formats: ALL_FORMATS }),
    output: new Output({
      format: new Mp4OutputFormat(),
      target: new BufferTarget(),
    }),
    video: {
      width: outputSize.width,
      height: outputSize.height,
      fit: 'contain',
      frameRate,
      bitrate: QUALITY_MEDIUM,
    },
    audio: {
      bitrate: QUALITY_MEDIUM,
    },
    showWarnings: false,
  })

  if (!conversion.isValid) {
    throw new Error('Conversion 配置无效，请检查输入文件和输出格式')
  }

  conversion.onProgress = (progress: number) => {
    if (DEBUG_EXPORT) console.log(`[exportVideoMediaItem] progress: ${progress.toFixed(3)}`)
    onProgress?.(progress)
  }

  if (DEBUG_EXPORT) console.log('[exportVideoMediaItem] execute start')
  await conversion.execute()
  if (DEBUG_EXPORT) console.log('[exportVideoMediaItem] execute done')

  const buffer = (conversion.output.target as BufferTarget).buffer
  if (!buffer) {
    throw new Error('Conversion 输出为空')
  }
  return new Blob([buffer], { type: 'video/mp4' })
}

/**
 * 导出音频媒体项目为 Blob（直接返回原始文件）
 */
async function exportAudioMediaItem(
  mediaItem: UnifiedMediaItemData,
  onProgress?: (progress: number) => void,
): Promise<Blob> {
  // 从 BunnyMedia 获取原始文件
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

  // 1. 类型检查
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
 * 导出图片时间轴项目为 PNG Blob
 */
async function exportImageTimelineItem(
  timelineItem: UnifiedTimelineItemData,
  getMediaItem: (id: string | null) => UnifiedMediaItemData | undefined,
  onProgress?: (progress: number) => void,
): Promise<Blob> {
  // 1. 获取媒体项目
  const mediaItem = getMediaItem(timelineItem.mediaItemId)
  if (!mediaItem) {
    throw new Error(`找不到媒体项目: ${timelineItem.mediaItemId}`)
  }

  // 2. 直接调用 exportImageMediaItem
  return await exportImageMediaItem(mediaItem, onProgress)
}

/**
 * 导出视频时间轴项目为 MP4 Blob（使用 Conversion + trim 裁剪）
 */
async function exportVideoTimelineItem(
  timelineItem: UnifiedTimelineItemData,
  getMediaItem: (id: string | null) => UnifiedMediaItemData | undefined,
  onProgress?: (progress: number) => void,
  frameRate?: number,
  sizeOptions?: Pick<ExportMediaItemOptions, 'outputWidth' | 'outputHeight'>,
): Promise<Blob> {
  // 1. 获取媒体项目
  const mediaItem = getMediaItem(timelineItem.mediaItemId)
  if (!mediaItem) {
    throw new Error(`找不到媒体项目: ${timelineItem.mediaItemId}`)
  }

  // 2. 验证媒体项目状态
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

  // 3. 计算裁剪范围（帧 → 秒）
  const trimStart = timelineItem.timeRange.clipStartTime / RENDERER_FPS
  const trimEnd = timelineItem.timeRange.clipEndTime / RENDERER_FPS

  // 4. 使用 Conversion 裁剪 + 转码
  const file = bunnyMedia.getOriFile()
  const conversion = await Conversion.init({
    input: new Input({ source: new BlobSource(file), formats: ALL_FORMATS }),
    output: new Output({
      format: new Mp4OutputFormat(),
      target: new BufferTarget(),
    }),
    video: {
      width: outputWidth,
      height: outputHeight,
      fit: 'contain',
      frameRate,
      bitrate: QUALITY_MEDIUM,
    },
    audio: {
      bitrate: QUALITY_MEDIUM,
    },
    trim: { start: trimStart, end: trimEnd },
    showWarnings: false,
  })

  if (!conversion.isValid) {
    throw new Error('Conversion 配置无效，请检查输入文件和输出格式')
  }

  conversion.onProgress = (progress: number) => {
    if (DEBUG_EXPORT) console.log(`[exportVideoTimelineItem] progress: ${progress.toFixed(3)}`)
    onProgress?.(progress)
  }

  if (DEBUG_EXPORT) console.log(`[exportVideoTimelineItem] execute start, trim: ${trimStart}s ~ ${trimEnd}s`)
  await conversion.execute()
  if (DEBUG_EXPORT) console.log('[exportVideoTimelineItem] execute done')

  const buffer = (conversion.output.target as BufferTarget).buffer
  if (!buffer) {
    throw new Error('Conversion 输出为空')
  }
  return new Blob([buffer], { type: 'video/mp4' })
}

/**
 * 导出视频/音频时间轴项目为音频 MP3 Blob（使用 Conversion + trim 裁剪）
 */
async function exportAudioTimelineItem(
  timelineItem: UnifiedTimelineItemData<'video' | 'audio'>,
  getMediaItem: (id: string) => UnifiedMediaItemData | undefined,
  onProgress?: (progress: number) => void,
): Promise<Blob> {
  // 1. 获取媒体项目
  const mediaItem = getMediaItem(timelineItem.mediaItemId)
  if (!mediaItem) {
    throw new Error(`找不到媒体项目: ${timelineItem.mediaItemId}`)
  }

  // 2. 验证媒体项目状态
  if (mediaItem.mediaStatus !== 'ready') {
    throw new Error('媒体项目未就绪')
  }

  const bunnyMedia = mediaItem.runtime.bunny?.bunnyMedia
  if (!bunnyMedia) {
    throw new Error('媒体项目未就绪：bunnyMedia 不存在')
  }
  await bunnyMedia.ready

  // 3. 计算裁剪范围（帧 → 秒）
  const trimStart = timelineItem.timeRange.clipStartTime / RENDERER_FPS
  const trimEnd = timelineItem.timeRange.clipEndTime / RENDERER_FPS

  // 4. 使用 Conversion 提取音频
  const file = bunnyMedia.getOriFile()
  const conversion = await Conversion.init({
    input: new Input({ source: new BlobSource(file), formats: ALL_FORMATS }),
    output: new Output({
      format: new Mp3OutputFormat(),
      target: new BufferTarget(),
    }),
    video: { discard: true },
    audio: {
      bitrate: QUALITY_MEDIUM,
    },
    trim: { start: trimStart, end: trimEnd },
    showWarnings: false,
  })

  if (!conversion.isValid) {
    throw new Error('Conversion 配置无效，请检查输入文件和输出格式')
  }

  conversion.onProgress = (progress: number) => {
    if (DEBUG_EXPORT) console.log(`[exportAudioTimelineItem] progress: ${progress.toFixed(3)}`)
    onProgress?.(progress)
  }

  if (DEBUG_EXPORT) console.log(`[exportAudioTimelineItem] execute start, trim: ${trimStart}s ~ ${trimEnd}s`)
  await conversion.execute()
  if (DEBUG_EXPORT) console.log('[exportAudioTimelineItem] execute done')

  const buffer = (conversion.output.target as BufferTarget).buffer
  if (!buffer) {
    throw new Error('Conversion 输出为空')
  }
  return new Blob([buffer], { type: 'audio/mpeg' })
}

/**
 * 导出单个时间轴项目为 Blob（使用原始尺寸）
 */
export async function exportTimelineItem(options: ExportTimelineItemOptions): Promise<Blob> {
  const { timelineItem, onProgress, getMediaItem, frameRate, exportType, outputWidth, outputHeight } = options

  // 1. 类型检查
  if (timelineItem.mediaType === 'image') {
    return await exportImageTimelineItem(timelineItem, getMediaItem, onProgress)
  }

  if (timelineItem.mediaType === 'video') {
    // 如果指定了音频导出类型，导出为音频
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
    // 音频时间轴项目只能导出为音频
    return await exportAudioTimelineItem(
      timelineItem as UnifiedTimelineItemData<'audio'>,
      getMediaItem,
      onProgress,
    )
  }

  throw new Error(`不支持导出 ${timelineItem.mediaType} 类型的时间轴项目`)
}
