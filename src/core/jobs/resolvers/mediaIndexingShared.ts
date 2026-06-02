import { globalMetaFileManager } from '@/core/managers/media/globalMetaFileManager'
import type {
  ImageMediaItem,
  MediaIndexStatus,
  UnifiedVideoMediaIndexMetadata,
  UnifiedMediaIndexMetadata,
  UnifiedMediaItemData,
  VideoMediaItem,
} from '@/core/mediaitem/types'
import type { UnifiedMediaModule } from '@/core/modules/UnifiedMediaModule'
import { RENDERER_FPS } from '@/core/mediabunny/constant'
import type { FileData, FinalEvent, TaskStreamEvent } from '@/core/datasource/providers/ai-generation/types'
import { TaskStatus, TaskStreamEventType } from '@/core/datasource/providers/ai-generation/types'
import type { UnifiedTimelineItemData, VideoMediaConfig } from '@/core/timelineitem/type'
import { DEFAULT_BLEND_MODE } from '@/core/timelineitem'
import { createDefaultMaskConfig } from '@/core/timelineitem/mask'
import type { UploadFileExportOptions } from '@/core/utils/bizyairFileUploader'
import { fetchClient, sleepWithAbortSignal } from '@/utils/fetchClient'
import type { ResourcePolicy, ResourceRequest } from '../ResourceTypes'

export const VIDEO_SCENE_SEGMENTS_RESOURCE_TYPE = 'video-scene-segments'
export const VIDEO_SEGMENT_EXPORTS_RESOURCE_TYPE = 'video-segment-exports'
export const VIDEO_SEGMENT_OSS_UPLOADS_RESOURCE_TYPE = 'video-segment-oss-uploads'
export const MEDIA_INDEX_TASK_SUBMIT_RESOURCE_TYPE = 'media-index-task-submit'
export const MEDIA_INDEX_TASK_COMPLETE_RESOURCE_TYPE = 'media-index-task-complete'
export const MEDIA_INDEX_METADATA_WRITEBACK_RESOURCE_TYPE = 'media-index-metadata-writeback'

export const SHORT_SEGMENT_MAX_DURATION_SECONDS = 3

export interface VideoSceneSegmentsInput {
  mediaId: string
}

export interface VideoSceneSegment {
  mediaItemId: string
  segmentIndex: number
  startFrame: number
  endFrame: number
  durationN: number
}

export interface VideoSceneSegmentsResult {
  mediaId: string
  segments: VideoSceneSegment[]
}

export interface VideoSegmentExportsInput {
  mediaId: string
}

export type VideoSegmentExportPlan =
  | {
      exportKind: 'video'
      segment: VideoSceneSegment
      fileData: FileData
      exportOptions?: UploadFileExportOptions
    }
  | {
      exportKind: 'frames'
      segment: VideoSceneSegment
      frameExportOptions: {
        timestampsMs: number[]
        frameCount: number
        outputWidth?: number
        outputHeight?: number
      }
      fileData: FileData
      exportOptions?: UploadFileExportOptions
    }

export interface VideoSegmentExportsResult {
  mediaId: string
  exportPlans: VideoSegmentExportPlan[]
  timelineItems: Record<string, UnifiedTimelineItemData<'video'>>
}

export interface VideoSegmentOssUploadsInput {
  mediaId: string
}

export type MediaIndexSegmentInput =
  | {
      mediaItemId: string
      segmentIndex: number
      startTimecode: string
      endTimecode: string
      durationN: number
      sourceType: 'video_url'
      taggingOssUrl: string
      embeddingOssUrl: string
    }
  | {
      mediaItemId: string
      segmentIndex: number
      startTimecode: string
      endTimecode: string
      durationN: number
      sourceType: 'image_urls'
      taggingImageUrls: string[]
      imageTimecodes: string[]
      embeddingVideoUrl: string
    }
  | {
      mediaItemId: string
      sourceType: 'image_url'
      taggingImageUrl: string
      embeddingImageUrl: string
    }

export interface VideoSegmentOssUploadsResult {
  mediaId: string
  segments: MediaIndexSegmentInput[]
}

export interface MediaIndexTaskSubmitInput {
  mediaId: string
}

export interface MediaIndexTaskSubmitResult {
  mediaId: string
  taskId: string
}

export interface MediaIndexTaskCompleteInput {
  mediaId: string
  taskId?: string
}

export interface VideoMediaIndexingResult {
  media_kind: 'video'
  project_id: string
  media_item_id: string
  segment_count: number
  indexed_count: number
  failed_segment_count: number
  summary?: {
    title?: string
    summary?: string
  }
  segment_summaries?: Array<{
    segment_index: number
    start_timecode: string
    end_timecode: string
    title?: string
    summary?: string
  }>
  indexed_at?: string
  failed_segments?: Array<{
    segment_index?: number
    start_timecode?: string
    end_timecode?: string
    oss_url?: string
    error: string
  }>
  metadata?: {
    status?: MediaIndexStatus
    vector_names?: string[]
  }
}

export interface ImageMediaIndexingResult {
  media_kind: 'image'
  project_id: string
  media_item_id: string
  indexed_count: number
  summary?: {
    title?: string
    summary?: string
  }
  failed_reason?: string
  indexed_at?: string
  metadata?: {
    status?: MediaIndexStatus
    vector_names?: string[]
  }
}

export type MediaIndexingResult = VideoMediaIndexingResult | ImageMediaIndexingResult

export interface MediaIndexingTaskResultData {
  url: string
  media_indexing_result?: MediaIndexingResult
}

export interface MediaIndexTaskCompleteResult {
  mediaId: string
  taskId: string
  result: MediaIndexingResult
}

export interface MediaIndexMetadataWritebackInput {
  mediaId: string
}

export interface MediaIndexMetadataWritebackResult {
  mediaId: string
  status: MediaIndexStatus
}

export type MediaIndexingModule = Pick<UnifiedMediaModule, 'getMediaItem'> & {
  ensureMediaReady(mediaId: string): Promise<unknown>
  getProjectId(): string
}

export function createVideoSceneSegmentsRequest(
  mediaId: string,
  policy?: ResourcePolicy,
): ResourceRequest<VideoSceneSegmentsInput> {
  return {
    type: VIDEO_SCENE_SEGMENTS_RESOURCE_TYPE,
    key: mediaId,
    input: { mediaId },
    policy: {
      queue: 'local-heavy',
      ...policy,
    },
  }
}

export function createVideoSegmentExportsRequest(
  mediaId: string,
  policy?: ResourcePolicy,
): ResourceRequest<VideoSegmentExportsInput> {
  return {
    type: VIDEO_SEGMENT_EXPORTS_RESOURCE_TYPE,
    key: mediaId,
    input: { mediaId },
    policy: {
      queue: 'export',
      ...policy,
    },
  }
}

export function createVideoSegmentOssUploadsRequest(
  mediaId: string,
  policy?: ResourcePolicy,
): ResourceRequest<VideoSegmentOssUploadsInput> {
  return {
    type: VIDEO_SEGMENT_OSS_UPLOADS_RESOURCE_TYPE,
    key: mediaId,
    input: { mediaId },
    policy: {
      queue: 'export',
      ...policy,
    },
  }
}

export function createMediaIndexTaskSubmitRequest(
  mediaId: string,
  policy?: ResourcePolicy,
): ResourceRequest<MediaIndexTaskSubmitInput> {
  return {
    type: MEDIA_INDEX_TASK_SUBMIT_RESOURCE_TYPE,
    key: mediaId,
    input: { mediaId },
    policy: {
      queue: 'ai-remote',
      ...policy,
    },
  }
}

export function createMediaIndexTaskCompleteRequest(
  mediaId: string,
  taskId?: string,
  policy?: ResourcePolicy,
): ResourceRequest<MediaIndexTaskCompleteInput> {
  return {
    type: MEDIA_INDEX_TASK_COMPLETE_RESOURCE_TYPE,
    key: taskId ? `${mediaId}:${taskId}` : mediaId,
    input: { mediaId, taskId },
    policy: {
      queue: 'ai-remote',
      ...policy,
    },
  }
}

export function createMediaIndexMetadataWritebackRequest(
  mediaId: string,
  policy?: ResourcePolicy,
): ResourceRequest<MediaIndexMetadataWritebackInput> {
  return {
    type: MEDIA_INDEX_METADATA_WRITEBACK_RESOURCE_TYPE,
    key: mediaId,
    input: { mediaId },
    policy: {
      queue: 'background',
      ...policy,
    },
  }
}

export function getIndexableMediaItem(
  module: MediaIndexingModule,
  mediaId: string,
): VideoMediaItem | ImageMediaItem {
  const mediaItem = module.getMediaItem(mediaId)
  if (!mediaItem || (mediaItem.mediaType !== 'video' && mediaItem.mediaType !== 'image')) {
    throw new Error(`仅支持图片或视频素材索引: ${mediaId}`)
  }
  return mediaItem as VideoMediaItem | ImageMediaItem
}

export function getVideoMediaItem(
  module: MediaIndexingModule,
  mediaId: string,
): VideoMediaItem {
  const mediaItem = getIndexableMediaItem(module, mediaId)
  if (mediaItem.mediaType !== 'video') {
    throw new Error(`仅支持视频素材索引: ${mediaId}`)
  }
  return mediaItem
}

export function buildSegmentsFromBoundaries(
  mediaItemId: string,
  totalFrames: number,
  boundaries: bigint[],
): VideoSceneSegment[] {
  const cutFrames = Array.from(
    new Set(boundaries.map((frame) => Math.max(0, Math.floor(Number(frame))))),
  )
    .filter((frame) => frame > 0 && frame < totalFrames)
    .sort((a, b) => a - b)

  const segments: VideoSceneSegment[] = []
  const segmentStarts = [0, ...cutFrames]
  const segmentEnds = [...cutFrames, totalFrames]

  for (let index = 0; index < segmentStarts.length; index += 1) {
    const startFrame = segmentStarts[index]
    const endFrame = segmentEnds[index]
    if (endFrame <= startFrame) {
      continue
    }

    segments.push({
      mediaItemId,
      segmentIndex: segments.length,
      startFrame,
      endFrame,
      durationN: endFrame - startFrame,
    })
  }

  if (segments.length === 0 && totalFrames > 0) {
    return [
      {
        mediaItemId,
        segmentIndex: 0,
        startFrame: 0,
        endFrame: totalFrames,
        durationN: totalFrames,
      },
    ]
  }

  return segments
}

export function createTemporaryVideoTimelineItem(
  mediaItem: UnifiedMediaItemData & { mediaType: 'video' },
  startFrame: number,
  endFrame: number,
  id: string = `${mediaItem.id}:analysis`,
): UnifiedTimelineItemData<'video'> {
  const width = mediaItem.runtime.bunny?.originalWidth || 1920
  const height = mediaItem.runtime.bunny?.originalHeight || 1080

  return {
    id,
    mediaType: 'video',
    mediaItemId: mediaItem.id,
    trackId: '__media-indexing__',
    timelineStatus: 'ready',
    timeRange: {
      timelineStartTime: 0,
      timelineEndTime: endFrame - startFrame,
      clipStartTime: startFrame,
      clipEndTime: endFrame,
    },
    config: {
      x: 0,
      y: 0,
      width,
      height,
      rotation: 0,
      opacity: 1,
      blendMode: DEFAULT_BLEND_MODE,
      proportionalScale: true,
      mask: createDefaultMaskConfig('rectangle', { width, height }),
      volume: 1,
      isMuted: false,
    } satisfies VideoMediaConfig,
    runtime: {
      isInitialized: true,
    },
  }
}

export function buildIndexingExportSize(
  mediaItem: UnifiedMediaItemData & { mediaType: 'video' },
): UploadFileExportOptions | undefined {
  const width = mediaItem.runtime.bunny?.originalWidth
  const height = mediaItem.runtime.bunny?.originalHeight
  if (!width || !height) {
    return {
      outputWidth: 480,
      outputHeight: 270,
      frameRate: 10,
    }
  }

  const maxSide = Math.max(width, height)
  if (maxSide <= 480) {
    return {
      outputWidth: width,
      outputHeight: height,
      frameRate: 10,
    }
  }

  const scale = 480 / maxSide
  return {
    outputWidth: Math.max(2, Math.round(width * scale)),
    outputHeight: Math.max(2, Math.round(height * scale)),
    frameRate: 10,
  }
}

export function buildSegmentFileName(mediaName: string, segmentIndex: number): string {
  const dotIndex = mediaName.lastIndexOf('.')
  const baseName = dotIndex > 0 ? mediaName.slice(0, dotIndex) : mediaName
  const ext = dotIndex > 0 ? mediaName.slice(dotIndex) : '.mp4'
  return `${baseName}-segment-${String(segmentIndex).padStart(4, '0')}${ext}`
}

export function setIndexingMetadata(
  mediaItem: UnifiedMediaItemData,
  patch: {
    indexStatus: MediaIndexStatus
    mediaKind?: 'video' | 'image'
    indexedAt?: string
    lastIndexTaskId?: string
    segmentCount?: number
    failedSegmentCount?: number
    segmentSummaries?: UnifiedVideoMediaIndexMetadata['segmentSummaries']
    summary?: UnifiedMediaIndexMetadata['summary']
  },
): void {
  const current = mediaItem.metadata?.indexing
  const mediaKind = patch.mediaKind || current?.mediaKind || (mediaItem.mediaType === 'image' ? 'image' : 'video')
  mediaItem.metadata = {
    ...mediaItem.metadata,
    indexing: {
      ...(current || {}),
      mediaKind,
      ...patch,
    },
  }
}

export function shouldRecoverMediaIndexing(
  indexing: UnifiedMediaIndexMetadata | undefined,
): boolean {
  return indexing?.indexStatus === 'pending' || indexing?.indexStatus === 'processing'
}

export function canResumeMediaIndexingFromRemote(
  indexing: UnifiedMediaIndexMetadata | undefined,
): boolean {
  return shouldRecoverMediaIndexing(indexing) && Boolean(indexing?.lastIndexTaskId)
}

export function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) {
    throw new DOMException('素材索引已取消', 'AbortError')
  }
}

export async function persistMediaItem(mediaItem: UnifiedMediaItemData): Promise<void> {
  const success = await globalMetaFileManager.saveMetaFile(mediaItem)
  if (!success) {
    throw new Error(`保存媒体元数据失败: ${mediaItem.name}`)
  }
}

export async function waitForMediaIndexTaskCompletion(
  mediaItem: UnifiedMediaItemData,
  taskId: string,
  onProgress: (patch: { progress?: number; stage?: string; message?: string }) => void,
  signal: AbortSignal,
): Promise<MediaIndexingResult> {
  let finalResult: MediaIndexingResult | null = null
  let needReconnect = true
  let delaySeconds = 1

  while (needReconnect) {
    await fetchClient
      .stream<TaskStreamEvent>(
        'GET',
        `/api/media/tasks/${taskId}/status`,
        (event): boolean | void => {
          if (event.type === TaskStreamEventType.PROGRESS_UPDATE) {
            setIndexingMetadata(mediaItem, {
              indexStatus: 'processing',
              lastIndexTaskId: taskId,
            })
            onProgress({
              progress: Math.max(0.05, Math.min(0.95, event.progress / 100)),
              stage: 'polling-index-task',
              message: event.message,
            })
            return false
          }

          if (event.type === TaskStreamEventType.FINAL) {
            const finalEvent = event as FinalEvent
            if (finalEvent.status === TaskStatus.FAILED) {
              setIndexingMetadata(mediaItem, {
                indexStatus: 'failed',
                lastIndexTaskId: taskId,
              })
              throw new Error(finalEvent.message || '素材索引失败')
            }

            if (finalEvent.status === TaskStatus.CANCELLED) {
              setIndexingMetadata(mediaItem, {
                indexStatus: 'failed',
                lastIndexTaskId: taskId,
              })
              throw new Error(finalEvent.message || '素材索引已取消')
            }

            const resultData = finalEvent.result_data as MediaIndexingTaskResultData | undefined
            if (!resultData?.media_indexing_result) {
              throw new Error('索引任务 FINAL 事件缺少 media_indexing_result')
            }

            finalResult = resultData.media_indexing_result
            needReconnect = false
            return true
          }

          if (event.type === TaskStreamEventType.NOT_FOUND) {
            setIndexingMetadata(mediaItem, {
              indexStatus: 'failed',
              lastIndexTaskId: taskId,
            })
            throw new Error(event.message)
          }

          if (event.type === TaskStreamEventType.ERROR) {
            return true
          }

          return false
        },
        undefined,
        { signal },
      )
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === 'AbortError') {
          throw error
        }
        if (error instanceof Error) {
          throw error
        }
        throw new Error(String(error))
      })

    if (needReconnect) {
      const jitter = delaySeconds * 0.2 * (Math.random() * 2 - 1)
      const actualDelay = Math.max(0, delaySeconds + jitter)
      await sleepWithAbortSignal(actualDelay * 1000, signal)
      delaySeconds = Math.min(delaySeconds * 2, 60)
    }
  }

  if (!finalResult) {
    throw new Error('未获取到索引任务结果')
  }

  return finalResult
}

export function isShortSegment(durationN: number): boolean {
  return durationN <= SHORT_SEGMENT_MAX_DURATION_SECONDS * RENDERER_FPS
}

export function computeFrameTimestampsMs(durationN: number): {
  frameCount: number
  timestampsMs: number[]
} {
  const durationSeconds = durationN / RENDERER_FPS
  const frameCount = Math.min(6, Math.max(4, Math.round(durationSeconds * 2)))
  const timestampsMs: number[] = []
  for (let i = 0; i < frameCount; i += 1) {
    const centerMs = ((i + 0.5) / frameCount) * durationSeconds * 1000
    timestampsMs.push(Math.round(centerMs))
  }
  return { frameCount, timestampsMs }
}

export function buildFrameFileName(mediaName: string, segmentIndex: number, frameIndex: number): string {
  const dotIndex = mediaName.lastIndexOf('.')
  const baseName = dotIndex > 0 ? mediaName.slice(0, dotIndex) : mediaName
  return `${baseName}-segment-${String(segmentIndex).padStart(4, '0')}-frame-${String(frameIndex).padStart(2, '0')}.png`
}
