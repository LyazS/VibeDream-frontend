import { BizyairFileUploader } from '@/core/utils/bizyairFileUploader'
import type { ResolveContext, ResourceResolver } from '../ResourceResolver'
import type { ResourceRequest } from '../ResourceTypes'
import {
  createVideoSegmentExportsRequest,
  createVideoSegmentOssUploadsRequest,
  getVideoMediaItem,
  throwIfAborted,
  type MediaIndexSegmentInput,
  type MediaIndexingModule,
  type VideoSegmentExportsResult,
  type VideoSegmentOssUploadsInput,
  type VideoSegmentOssUploadsResult,
  VIDEO_SEGMENT_OSS_UPLOADS_RESOURCE_TYPE,
} from './mediaIndexingShared'

export class VideoSegmentOssUploadsResolver
  implements ResourceResolver<VideoSegmentOssUploadsInput, VideoSegmentOssUploadsResult>
{
  readonly type = VIDEO_SEGMENT_OSS_UPLOADS_RESOURCE_TYPE

  constructor(private readonly module: MediaIndexingModule) {}

  getKey(input: VideoSegmentOssUploadsInput): string {
    return input.mediaId
  }

  async getDependencies(ctx: ResolveContext<VideoSegmentOssUploadsInput>): Promise<ResourceRequest[]> {
    return [createVideoSegmentExportsRequest(ctx.input.mediaId)]
  }

  async resolve(ctx: ResolveContext<VideoSegmentOssUploadsInput>): Promise<VideoSegmentOssUploadsResult> {
    const mediaItem = getVideoMediaItem(this.module, ctx.input.mediaId)
    const exportResult = await ctx.ensure<VideoSegmentExportsResult>(
      createVideoSegmentExportsRequest(ctx.input.mediaId),
    )
    const uploadedSegments: MediaIndexSegmentInput[] = []
    const getTimelineItem = (id: string) => exportResult.timelineItems[id]

    for (let index = 0; index < exportResult.exportPlans.length; index += 1) {
      throwIfAborted(ctx.signal)
      const plan = exportResult.exportPlans[index]
      ctx.update({
        progress: Math.max(0.05, Math.min(0.95, index / Math.max(1, exportResult.exportPlans.length))),
        stage: 'uploading-segments',
        message: `正在上传分片 ${index + 1}/${exportResult.exportPlans.length}: ${mediaItem.name}`,
      })

      const uploadResult = await BizyairFileUploader.uploadFile(
        plan.fileData,
        this.module.getMediaItem,
        getTimelineItem,
        (stage, progress) => {
          const normalized = (index + progress / 100) / Math.max(1, exportResult.exportPlans.length)
          ctx.update({
            progress: Math.max(0.05, Math.min(0.95, normalized)),
            stage: 'uploading-segments',
            message: `${stage} ${index + 1}/${exportResult.exportPlans.length}`,
          })
        },
        plan.exportOptions,
      )

      if (!uploadResult.success || !uploadResult.url) {
        throw new Error(uploadResult.error || `上传分片失败: ${plan.fileData.name}`)
      }

      uploadedSegments.push({
        mediaItemId: mediaItem.id,
        segmentIndex: plan.segment.segmentIndex,
        startTimecode: plan.segment.startTimecode,
        endTimecode: plan.segment.endTimecode,
        durationMs: plan.segment.durationMs,
        ossUrl: uploadResult.url,
      })
    }

    ctx.update({
      progress: 1,
      stage: 'segments-uploaded',
      message: `分片上传完成，共 ${uploadedSegments.length} 段`,
    })

    return {
      mediaId: mediaItem.id,
      segments: uploadedSegments,
    }
  }
}

export function createVideoSegmentOssUploadsResolver(
  module: MediaIndexingModule,
): VideoSegmentOssUploadsResolver {
  return new VideoSegmentOssUploadsResolver(module)
}

export { createVideoSegmentOssUploadsRequest }
