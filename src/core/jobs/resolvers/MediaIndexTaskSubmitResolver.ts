import { exportMediaItem } from '@/core/utils/mediaExporter'
import type { ImageMediaItem, VideoMediaItem } from '@/core/mediaitem/types'
import type { ResolveCheckContext, ResolveContext, ResourceResolver } from '../ResourceResolver'
import type { ResourceRequest } from '../ResourceTypes'
import { CloudflareTemporaryFileUploader } from '@/core/utils/cloudflareTemporaryFileUploader'
import {
  createMediaTaskIdempotencyKey,
  getTaskProgressOriginTabId,
  submitMediaTask,
} from './mediaTaskApi'
import type { MediaIndexingTask, MediaIndexingTaskSubmission } from './mediaIndexingTask'
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
const INDEXING_INPUT_TTL_MILLISECONDS = 45 * 60 * 1000

function buildImageIndexingExportSize(
  mediaItem: ImageMediaItem | VideoMediaItem,
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

function providerSegments(
  segments: MediaIndexSegmentInput[],
): MediaIndexingTaskSubmission['input']['segments'] {
  return segments.map((segment) => {
    if (segment.sourceType === 'image_url') {
      return {
        segment_id: 'image',
        provider_urls: [segment.taggingImageUrl, segment.embeddingImageUrl],
        source_type: segment.sourceType,
      }
    }
    const metadata = {
      source_type: segment.sourceType,
      segment_index: segment.segmentIndex,
      start_timecode: segment.startTimecode,
      end_timecode: segment.endTimecode,
      duration_n: segment.durationN,
    }
    if (segment.sourceType === 'image_urls') {
      return {
        segment_id: `segment-${segment.segmentIndex}`,
        provider_urls: [...segment.taggingImageUrls, segment.embeddingVideoUrl],
        image_timecodes: segment.imageTimecodes,
        ...metadata,
      }
    }
    return {
      segment_id: `segment-${segment.segmentIndex}`,
      provider_urls: [segment.taggingOssUrl, segment.embeddingOssUrl],
      ...metadata,
    }
  })
}

async function createMediaVersion(
  mediaItem: ReturnType<typeof getIndexableMediaItem>,
  segments: MediaIndexSegmentInput[],
): Promise<string> {
  const stableSegments = segments.map((segment) => {
    if (segment.sourceType === 'image_url') return { source_type: segment.sourceType }
    return {
      source_type: segment.sourceType,
      segment_index: segment.segmentIndex,
      start_timecode: segment.startTimecode,
      end_timecode: segment.endTimecode,
      duration_n: segment.durationN,
      ...(segment.sourceType === 'image_urls' ? { image_timecodes: segment.imageTimecodes } : {}),
    }
  })
  const source = JSON.stringify({
    schema: 1,
    media_id: mediaItem.id,
    created_at: mediaItem.createdAt,
    media_kind: mediaItem.mediaType,
    duration: mediaItem.duration,
    segments: stableSegments,
  })
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(source))
  return `v1-${Array.from(new Uint8Array(hash), (byte) => byte.toString(16).padStart(2, '0')).join('')}`
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
    // 项目重新打开时优先复用仍在处理中的新 Cloudflare 任务，避免再次上传与重复扣费。
    if (canResumeMediaIndexingFromRemote(indexing) && typeof taskId === 'string' && taskId.trim()) {
      return {
        mediaId: ctx.input.mediaId,
        taskId,
      }
    }

    return null
  }

  async getDependencies(
    ctx: ResolveContext<MediaIndexTaskSubmitInput>,
  ): Promise<ResourceRequest[]> {
    const mediaItem = this.module.getMediaItem(ctx.input.mediaId)
    if (mediaItem?.mediaType === 'video') {
      return [createVideoSegmentOssUploadsRequest(ctx.input.mediaId)]
    }
    return []
  }

  async resolve(
    ctx: ResolveContext<MediaIndexTaskSubmitInput>,
  ): Promise<MediaIndexTaskSubmitResult> {
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
      ctx.signal.throwIfAborted()

      // DashScope 的视觉打标与多模态 embedding 分别申请用途受限的 OSS policy，
      // 即使当前 Blob 相同也不复用 URL，避免模型资源用途混淆。
      const taggingResult = await CloudflareTemporaryFileUploader.uploadBlob(
        imageBlob,
        { capability: 'indexing', purpose: 'tagging', fileName: mediaItem.name },
        (progress) => {
          ctx.update({
            progress: Math.max(0.05, Math.min(0.25, (progress / 100) * 0.2 + 0.05)),
            stage: 'uploading-image',
            message: `上传打标图片: ${progress}%`,
          })
        }, ctx.signal,
      )

      if (!taggingResult.success || !taggingResult.url) {
        throw new Error(taggingResult.error || `上传打标图片失败: ${mediaItem.name}`)
      }

      ctx.update({
        progress: 0.25,
        stage: 'uploading-image',
        message: `正在上传图片素材（向量化）: ${mediaItem.name}`,
      })

      const embeddingResult = await CloudflareTemporaryFileUploader.uploadBlob(
        imageBlob,
        { capability: 'indexing', purpose: 'embedding', fileName: mediaItem.name },
        (progress) => {
          ctx.update({
            progress: Math.max(0.25, Math.min(0.45, (progress / 100) * 0.2 + 0.25)),
            stage: 'uploading-image',
            message: `上传向量化图片: ${progress}%`,
          })
        }, ctx.signal,
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

    ctx.signal.throwIfAborted()
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

    // 媒体版本由素材与分片计划计算。后端用它进行活跃任务去重，同一版本不会重复创建任务。
    const response = await submitMediaTask<MediaIndexingTask, MediaIndexingTaskSubmission>(
      'indexing',
      {
        project_id: this.module.getProjectId(),
        origin_tab_id: getTaskProgressOriginTabId(),
        input: {
          media_id: mediaItem.id,
          media_version: await createMediaVersion(mediaItem, segments),
          media_kind: mediaItem.mediaType,
          media_name: mediaItem.name,
          expires_at: new Date(Date.now() + INDEXING_INPUT_TTL_MILLISECONDS).toISOString(),
          segments: providerSegments(segments),
        },
      },
      createMediaTaskIdempotencyKey('indexing'),
      ctx.signal,
    )

    if (response.capability !== 'indexing' || !response.task_id) {
      throw new Error('素材索引任务返回数据无效')
    }

    setIndexingMetadata(mediaItem, {
      mediaKind: mediaItem.mediaType,
      indexStatus: 'processing',
      lastIndexTaskId: response.task_id,
    })
    await persistMediaItem(mediaItem)

    ctx.update({
      progress: 1,
      stage: 'index-task-submitted',
      message: `索引任务已提交: ${response.task_id}`,
    })

    return {
      mediaId: mediaItem.id,
      taskId: response.task_id,
    }
  }
}

export function createMediaIndexTaskSubmitResolver(
  module: MediaIndexingModule,
): MediaIndexTaskSubmitResolver {
  return new MediaIndexTaskSubmitResolver(module)
}

export { createMediaIndexTaskSubmitRequest }
