import { fetchClient } from '@/utils/fetchClient'
import type { TaskSubmitResponse } from '@/types/taskApi'
import type { ResolveCheckContext, ResolveContext, ResourceResolver } from '../ResourceResolver'
import type { ResourceRequest } from '../ResourceTypes'
import {
  canResumeMediaIndexingFromRemote,
  createMediaIndexTaskSubmitRequest,
  createVideoSegmentOssUploadsRequest,
  getVideoMediaItem,
  persistMediaItem,
  setIndexingMetadata,
  type MediaIndexTaskSubmitInput,
  type MediaIndexTaskSubmitResult,
  type MediaIndexingModule,
  type VideoSegmentOssUploadsResult,
  MEDIA_INDEX_TASK_SUBMIT_RESOURCE_TYPE,
} from './mediaIndexingShared'

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
    return [createVideoSegmentOssUploadsRequest(ctx.input.mediaId)]
  }

  async resolve(ctx: ResolveContext<MediaIndexTaskSubmitInput>): Promise<MediaIndexTaskSubmitResult> {
    const mediaItem = getVideoMediaItem(this.module, ctx.input.mediaId)
    const uploadResult = await ctx.ensure<VideoSegmentOssUploadsResult>(
      createVideoSegmentOssUploadsRequest(ctx.input.mediaId),
    )

    setIndexingMetadata(mediaItem, {
      indexStatus: 'processing',
      segmentCount: uploadResult.segments.length,
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
        segments: uploadResult.segments.map((segment) => {
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
