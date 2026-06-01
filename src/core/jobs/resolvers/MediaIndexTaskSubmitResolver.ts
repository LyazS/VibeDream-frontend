import { fetchClient } from '@/utils/fetchClient'
import { BizyairFileUploader } from '@/core/utils/bizyairFileUploader'
import type { TaskSubmitResponse } from '@/types/taskApi'
import type { ResolveCheckContext, ResolveContext, ResourceResolver } from '../ResourceResolver'
import type { ResourceRequest } from '../ResourceTypes'
import {
  canResumeMediaIndexingFromRemote,
  createMediaIndexTaskSubmitRequest,
  createVideoSegmentOssUploadsRequest,
  getIndexableMediaItem,
  persistMediaItem,
  setIndexingMetadata,
  type MediaIndexTaskSubmitInput,
  type MediaIndexTaskSubmitResult,
  type MediaIndexSegmentInput,
  type MediaIndexingModule,
  type VideoSegmentOssUploadsResult,
  MEDIA_INDEX_TASK_SUBMIT_RESOURCE_TYPE,
} from './mediaIndexingShared'

const IMAGE_INDEXING_MAX_SIDE = 768

function buildImageIndexingExportSize(
  mediaItem: MediaIndexingModule['getMediaItem'] extends (id: any) => infer T ? NonNullable<T> : never,
): { outputWidth?: number; outputHeight?: number } | undefined {
  if (mediaItem.mediaType !== 'image') {
    return undefined
  }

  const width = mediaItem.runtime.bunny?.originalWidth
  const height = mediaItem.runtime.bunny?.originalHeight
  if (!width || !height) {
    return {
      outputWidth: IMAGE_INDEXING_MAX_SIDE,
    }
  }

  const maxSide = Math.max(width, height)
  if (maxSide <= IMAGE_INDEXING_MAX_SIDE) {
    return {
      outputWidth: width,
      outputHeight: height,
    }
  }

  const scale = IMAGE_INDEXING_MAX_SIDE / maxSide
  return {
    outputWidth: Math.max(1, Math.round(width * scale)),
    outputHeight: Math.max(1, Math.round(height * scale)),
  }
}

export class MediaIndexTaskSubmitResolver
  implements ResourceResolver<MediaIndexTaskSubmitInput, MediaIndexTaskSubmitResult>
{
  readonly type = MEDIA_INDEX_TASK_SUBMIT_RESOURCE_TYPE

  constructor(private readonly module: MediaIndexingModule) {}

  getKey(input: MediaIndexTaskSubmitInput): string {
    return input.mediaId
  }

  async isSatisfied(
    ctx: ResolveCheckContext<MediaIndexTaskSubmitInput>,
  ): Promise<MediaIndexTaskSubmitResult | null> {
    const mediaItem = this.module.getMediaItem(ctx.input.mediaId)
    const indexing = mediaItem?.metadata?.indexing
    const taskId = indexing?.lastIndexTaskId
    if (canResumeMediaIndexingFromRemote(indexing) && typeof taskId === 'string' && taskId.trim()) {
      return {
        mediaId: ctx.input.mediaId,
        taskId,
      }
    }

    return null
  }

  async getDependencies(ctx: ResolveContext<MediaIndexTaskSubmitInput>): Promise<ResourceRequest[]> {
    const mediaItem = this.module.getMediaItem(ctx.input.mediaId)
    if (mediaItem?.mediaType === 'video') {
      return [createVideoSegmentOssUploadsRequest(ctx.input.mediaId)]
    }
    return []
  }

  async resolve(ctx: ResolveContext<MediaIndexTaskSubmitInput>): Promise<MediaIndexTaskSubmitResult> {
    const mediaItem = getIndexableMediaItem(this.module, ctx.input.mediaId)
    let segments: MediaIndexSegmentInput[]

    if (mediaItem.mediaType === 'video') {
      const uploadResult = await ctx.ensure<VideoSegmentOssUploadsResult>(
        createVideoSegmentOssUploadsRequest(ctx.input.mediaId),
      )
      segments = uploadResult.segments
    } else {
      await this.module.ensureMediaReady(mediaItem.id)
      ctx.update({
        progress: 0.05,
        stage: 'uploading-image',
        message: `正在上传图片素材: ${mediaItem.name}`,
      })

      const uploadResult = await BizyairFileUploader.uploadFile(
        {
          __type__: 'FileData',
          source: 'media-item',
          name: mediaItem.name,
          mediaType: 'image',
          mediaItemId: mediaItem.id,
        },
        this.module.getMediaItem,
        () => undefined,
        (stage, progress) => {
          ctx.update({
            progress: Math.max(0.05, Math.min(0.45, progress / 100 * 0.4 + 0.05)),
            stage: 'uploading-image',
            message: `${stage}: ${mediaItem.name}`,
          })
        },
        buildImageIndexingExportSize(mediaItem),
      )

      if (!uploadResult.success || !uploadResult.url) {
        throw new Error(uploadResult.error || `上传图片素材失败: ${mediaItem.name}`)
      }

      segments = [
        {
          mediaItemId: mediaItem.id,
          sourceType: 'image_url',
          imageUrl: uploadResult.url,
        },
      ]
    }

    setIndexingMetadata(mediaItem, {
      indexStatus: 'processing',
      segmentCount: segments.length,
      failedSegmentCount: 0,
    })
    await persistMediaItem(mediaItem)

    ctx.update({
      progress: 0.1,
      stage: 'submitting-index-task',
      message: `正在提交索引任务: ${mediaItem.name}`,
    })

    const response = await fetchClient.post<TaskSubmitResponse>(
      '/api/media/indexing',
      {
        project_id: this.module.getProjectId(),
        media_item_id: mediaItem.id,
        media_name: mediaItem.name,
        segments: segments.map((segment) => {
          if (segment.sourceType === 'image_url') {
            return {
              media_item_id: segment.mediaItemId,
              source_type: segment.sourceType,
              image_url: segment.imageUrl,
            }
          }
          const base = {
            media_item_id: segment.mediaItemId,
            segment_index: segment.segmentIndex,
            start_timecode: segment.startTimecode,
            end_timecode: segment.endTimecode,
            duration_n: segment.durationN,
            source_type: segment.sourceType,
          }
          if (segment.sourceType === 'image_urls') {
            return {
              ...base,
              image_urls: segment.imageUrls,
              image_timecodes: segment.imageTimecodes,
              embedding_video_url: segment.embeddingVideoUrl,
            }
          }
          return {
            ...base,
            oss_url: segment.ossUrl,
          }
        }),
      },
      { signal: ctx.signal },
    )

    if (response.status !== 200) {
      throw new Error(`提交素材索引任务失败: ${response.statusText}`)
    }

    if (!response.data.success) {
      const details = response.data.error_details
      const message =
        (details && typeof details.error === 'string' && details.error) ||
        `提交素材索引任务失败: ${response.data.error_code}`
      throw new Error(message)
    }

    setIndexingMetadata(mediaItem, {
      indexStatus: 'processing',
      lastIndexTaskId: response.data.task_id,
    })
    await persistMediaItem(mediaItem)

    ctx.update({
      progress: 1,
      stage: 'index-task-submitted',
      message: `索引任务已提交: ${response.data.task_id}`,
    })

    return {
      mediaId: mediaItem.id,
      taskId: response.data.task_id,
    }
  }
}

export function createMediaIndexTaskSubmitResolver(
  module: MediaIndexingModule,
): MediaIndexTaskSubmitResolver {
  return new MediaIndexTaskSubmitResolver(module)
}

export { createMediaIndexTaskSubmitRequest }
