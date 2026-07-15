import type { UnifiedLibraryAssetData } from '@/core/asset/types'
import { TimeConstants } from '@/constants/TimeConstants'
import { DashScopeTemporaryFileUploader } from '@/core/utils/dashscopeTemporaryFileUploader'
import type { MediaType, UnifiedMediaItemData } from '@/core/mediaitem/types'
import type { UnifiedTimelineItemData } from '@/core/timelineitem/model/timelineItem'
import {
  captureTimelineFrames,
  type TimelineFrameCaptureOptions,
} from '@/core/utils/timelineFrameCapture'
import { framesToTimecode } from '@/core/utils/timeUtils'
import { fetchClient } from '@/utils/fetchClient'

export const FRAME_INSPECTION_MAX_FRAMES = 10
export const FRAME_INSPECTION_CAPTURE_MAX_SIDE = 960

const FRAME_INSPECTION_TIMECODE_REGEX = /^(\d{2}):(\d{2}):(\d{2})[:+](\d{2})$/

export interface FrameInspectionPoint {
  timecode: string
  frameNumber: number
}

export interface CapturedFrameInspectionPoint extends FrameInspectionPoint {
  blob: Blob
}

export interface UploadedFrameInspectionPoint extends CapturedFrameInspectionPoint {
  imageUrl: string
}

export interface FrameInspectionApiResponse {
  answer: string
  model: string
}

export type FrameInspectionRunStage = 'capturing' | 'captured' | 'uploading' | 'inspecting'

export interface FrameInspectionRunProgress {
  stage: FrameInspectionRunStage
  capturedFrames?: CapturedFrameInspectionPoint[]
  completedCount?: number
  totalCount?: number
  fileProgress?: number
  point?: CapturedFrameInspectionPoint
}

export interface CaptureInspectionFramesOptions {
  points: FrameInspectionPoint[]
  timelineItems: UnifiedTimelineItemData<MediaType>[]
  tracks: { id: string; isVisible: boolean; isMuted: boolean }[]
  getMediaItem: (id: string) => UnifiedMediaItemData | undefined
  getAsset: (id: string | null) => UnifiedLibraryAssetData | undefined
  videoResolution: { width: number; height: number }
}

export interface RunFrameInspectionOptions extends CaptureInspectionFramesOptions {
  instruction: string
  signal?: AbortSignal
  onProgress?: (progress: FrameInspectionRunProgress) => void
}

export interface FrameInspectionRunResult {
  capturedFrames: CapturedFrameInspectionPoint[]
  uploadedFrames: UploadedFrameInspectionPoint[]
  response: FrameInspectionApiResponse
}

export function normalizeInspectionTimecode(value: string): string {
  return value.trim().replace('+', ':')
}

export function parseInspectionTimecode(value: string): number {
  const normalized = normalizeInspectionTimecode(value)
  const match = normalized.match(FRAME_INSPECTION_TIMECODE_REGEX)
  if (!match) {
    throw new Error('invalid_timecode_format')
  }

  const hours = Number(match[1])
  const minutes = Number(match[2])
  const seconds = Number(match[3])
  const frames = Number(match[4])

  if (minutes >= 60 || seconds >= 60 || frames >= TimeConstants.FRAME_RATE) {
    throw new Error('invalid_timecode_value')
  }

  return (hours * 3600 + minutes * 60 + seconds) * TimeConstants.FRAME_RATE + frames
}

export function framesToInspectionTimecode(frames: number): string {
  return framesToTimecode(frames).replace('+', ':')
}

export function buildInspectionCaptureSize(
  width: number,
  height: number,
  maxSide: number = FRAME_INSPECTION_CAPTURE_MAX_SIDE,
): { width: number; height: number } {
  const longestSide = Math.max(width, height)
  if (longestSide <= maxSide) {
    return { width, height }
  }

  const scale = maxSide / longestSide
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  }
}

export async function captureInspectionFrames(
  options: CaptureInspectionFramesOptions,
): Promise<CapturedFrameInspectionPoint[]> {
  const captureSize = buildInspectionCaptureSize(
    options.videoResolution.width,
    options.videoResolution.height,
  )

  const captureConfig: TimelineFrameCaptureOptions = {
    videoWidth: captureSize.width,
    videoHeight: captureSize.height,
    timelineItems: options.timelineItems,
    tracks: options.tracks,
    getMediaItem: options.getMediaItem,
    getAsset: options.getAsset,
  }

  const blobs = await captureTimelineFrames(
    captureConfig,
    options.points.map((point) => point.frameNumber),
  )

  return options.points.map((point, index) => ({
    ...point,
    blob: blobs[index],
  }))
}

export async function uploadInspectionFrames(
  points: CapturedFrameInspectionPoint[],
  onProgress?: (
    completedCount: number,
    totalCount: number,
    fileProgress: number,
    point: CapturedFrameInspectionPoint,
  ) => void,
): Promise<UploadedFrameInspectionPoint[]> {
  const uploaded: UploadedFrameInspectionPoint[] = []
  const totalCount = points.length

  for (let index = 0; index < points.length; index++) {
    const point = points[index]
    const safeTimecode = point.timecode.replace(/:/g, '-')
    const fileName = `inspection-${safeTimecode}-${Date.now()}-${index + 1}.png`

    const uploadResult = await DashScopeTemporaryFileUploader.uploadBlob(
      point.blob,
      fileName,
      'inspection',
      (progress) => {
        onProgress?.(index, totalCount, progress, point)
      },
    )

    if (!uploadResult.success || !uploadResult.url) {
      throw new Error(uploadResult.error || '上传巡检图片失败')
    }

    onProgress?.(index + 1, totalCount, 100, point)
    uploaded.push({
      ...point,
      imageUrl: uploadResult.url,
    })
  }

  return uploaded
}

export async function callFrameInspectionApi(
  instruction: string,
  points: UploadedFrameInspectionPoint[],
  signal?: AbortSignal,
): Promise<FrameInspectionApiResponse> {
  const response = await fetchClient.post<FrameInspectionApiResponse>(
    '/api/media/frame-inspection',
    {
      instruction,
      frames: points.map((point) => ({
        timecode: point.timecode,
        image_url: point.imageUrl,
      })),
    },
    { signal },
  )

  if (!response.data?.answer || !response.data?.model) {
    throw new Error('巡检接口返回数据不完整')
  }

  return response.data
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw new DOMException('Frame inspection execution aborted', 'AbortError')
  }
}

/** Shared browser-side workflow used by the inspection panel and Agent tools. */
export async function runFrameInspection(
  options: RunFrameInspectionOptions,
): Promise<FrameInspectionRunResult> {
  const { instruction, points, signal, onProgress, ...captureOptions } = options

  throwIfAborted(signal)
  onProgress?.({ stage: 'capturing' })
  const capturedFrames = await captureInspectionFrames({
    ...captureOptions,
    points,
  })

  throwIfAborted(signal)
  onProgress?.({ stage: 'captured', capturedFrames })
  onProgress?.({ stage: 'uploading', completedCount: 0, totalCount: capturedFrames.length })
  const uploadedFrames = await uploadInspectionFrames(
    capturedFrames,
    (completedCount, totalCount, fileProgress, point) => {
      onProgress?.({
        stage: 'uploading',
        completedCount,
        totalCount,
        fileProgress,
        point,
      })
    },
  )

  throwIfAborted(signal)
  onProgress?.({ stage: 'inspecting' })
  const response = await callFrameInspectionApi(instruction, uploadedFrames, signal)

  return { capturedFrames, uploadedFrames, response }
}
