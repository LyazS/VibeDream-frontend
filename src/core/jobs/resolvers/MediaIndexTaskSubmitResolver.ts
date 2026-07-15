import { fetchClient } from '@/utils/fetchClient'
import { DashScopeTemporaryFileUploader } from '@/core/utils/dashscopeTemporaryFileUploader'
import { exportMediaItem } from '@/core/utils/mediaExporter'
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
    } else if (mediaItem.mediaType === 'image') {
      await this.module.ensureMediaReady(mediaItem.id)
      ctx.update({
        progress: 0.05,
        stage: 'uploading-image',
        message: `正在上传图片素材（打标）: ${mediaItem.name}`,
      })

      const exportSize = buildImageIndexingExportSize(mediaItem)
      const imageBlob = await exportMediaItem({
        mediaItem,
        ...exportSize,
      })

      const taggingResult = await DashScopeTemporaryFileUploader.uploadBlob(
        imageBlob,
        mediaItem.name,
        'tagging',
        (progress) => {
          ctx.update({
            progress: Math.max(0.05, Math.min(0.25, progress / 100 * 0.2 + 0.05)),
            stage: 'uploading-image',
            message: `上传打标图片: ${progress}%`,
          })
        },
      )

      if (!taggingResult.success || !taggingResult.url) {
        throw new Error(taggingResult.error || `上传打标图片失败: ${mediaItem.name}`)
      }

      ctx.update({
        progress: 0.25,
        stage: 'uploading-image',
        message: `正在上传图片素材（向量化）: ${mediaItem.name}`,
      })

      const embeddingResult = await DashScopeTemporaryFileUploader.uploadBlob(
        imageBlob,
        mediaItem.name,
        'embedding',
        (progress) => {
          ctx.update({
            progress: Math.max(0.25, Math.min(0.45, progress / 100 * 0.2 + 0.25)),
            stage: 'uploading-image',
            message: `上传向量化图片: ${progress}%`,
          })
        },
      )

      if (!embeddingResult.success || !embeddingResult.url) {
        throw new Error(embeddingResult.error || `上传向量化图片失败: ${mediaItem.name}`)
      }

      segments = [
        {
          mediaItemId: mediaItem.id,
          sourceType: 'image_url',
          taggingImageUrl: taggingResult.url,
          embeddingImageUrl: embeddingResult.url,
        },
      ]
    } else {
      throw new Error('不支持的索引素材类型')
    }

    setIndexingMetadata(mediaItem, {
      mediaKind: mediaItem.mediaType,
      indexStatus: 'processing',
      segmentCount: segments.length,
      failedSegmentCount: mediaItem.mediaType === 'video' ? 0 : undefined,
      summary: undefined,
      segmentSummaries: undefined,
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
              tagging_image_url: segment.taggingImageUrl,
              embedding_image_url: segment.embeddingImageUrl,
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
              tagging_image_urls: segment.taggingImageUrls,
              image_timecodes: segment.imageTimecodes,
              embedding_video_url: segment.embeddingVideoUrl,
            }
          }
          return {
            ...base,
            tagging_oss_url: segment.taggingOssUrl,
            embedding_oss_url: segment.embeddingOssUrl,
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
      mediaKind: mediaItem.mediaType,
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
