import { DashScopeTemporaryFileUploader } from '@/core/utils/dashscopeTemporaryFileUploader'
import { exportMediaItem, exportTimelineItem, exportVideoFrames } from '@/core/utils/mediaExporter'
import type { ResolveContext, ResourceResolver } from '../ResourceResolver'
import type { ResourceRequest } from '../ResourceTypes'
import { RENDERER_FPS } from '@/core/mediabunny/constant'
import { framesToTimecode } from '@/core/utils/timeUtils'
import {
  buildFrameFileName,
  createVideoSegmentExportsRequest,
  createVideoSegmentOssUploadsRequest,
  getIndexableMediaItem,
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
    const mediaItem = getIndexableMediaItem(this.module, ctx.input.mediaId)
    if (mediaItem.mediaType !== 'video') {
      throw new Error(`仅视频素材需要分片上传: ${mediaItem.id}`)
    }
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

      if (plan.exportKind === 'frames') {
        const timelineItem = getTimelineItem(plan.fileData.timelineItemId!)
        if (!timelineItem) {
          throw new Error(`找不到时间轴项: ${plan.fileData.timelineItemId}`)
        }

        const videoBlob = await exportTimelineItem({
          timelineItem,
          getMediaItem: this.module.getMediaItem,
          ...plan.exportOptions,
        })

        const embeddingVideoResult = await DashScopeTemporaryFileUploader.uploadBlob(
          videoBlob,
          plan.fileData.name,
          'embedding',
          (progress) => {
            const normalized = (index + progress / 100) / Math.max(1, exportResult.exportPlans.length)
            ctx.update({
              progress: Math.max(0.05, Math.min(0.95, normalized * 0.3)),
              stage: 'uploading-segments',
              message: `上传短视频（向量化） ${index + 1}/${exportResult.exportPlans.length}`,
            })
          },
        )

        if (!embeddingVideoResult.success || !embeddingVideoResult.url) {
          throw new Error(embeddingVideoResult.error || `上传短视频分片失败: ${plan.fileData.name}`)
        }

        const frameBlobs = await exportVideoFrames({
          timelineItem: timelineItem as any,
          getMediaItem: this.module.getMediaItem,
          timestampsMs: plan.frameExportOptions.timestampsMs,
          outputWidth: plan.frameExportOptions.outputWidth,
          outputHeight: plan.frameExportOptions.outputHeight,
        })

        const taggingImageUrls: string[] = []
        for (let frameIdx = 0; frameIdx < frameBlobs.length; frameIdx += 1) {
          const frameName = buildFrameFileName(mediaItem.name, plan.segment.segmentIndex, frameIdx)
          const frameUploadResult = await DashScopeTemporaryFileUploader.uploadBlob(
            frameBlobs[frameIdx],
            frameName,
            'tagging',
            (progress) => {
              const frameProgress = (frameIdx + progress / 100) / frameBlobs.length
              const normalized = (index + 0.3 + frameProgress * 0.7) / Math.max(1, exportResult.exportPlans.length)
              ctx.update({
                progress: Math.max(0.05, Math.min(0.95, normalized)),
                stage: 'uploading-segments',
                message: `上传帧 ${frameIdx + 1}/${frameBlobs.length} ${index + 1}/${exportResult.exportPlans.length}`,
              })
            },
          )

          if (!frameUploadResult.success || !frameUploadResult.url) {
            throw new Error(frameUploadResult.error || `上传帧失败: ${frameName}`)
          }

          taggingImageUrls.push(frameUploadResult.url)
        }

        uploadedSegments.push({
          mediaItemId: mediaItem.id,
          segmentIndex: plan.segment.segmentIndex,
          startTimecode: framesToTimecode(plan.segment.startFrame),
          endTimecode: framesToTimecode(plan.segment.endFrame),
          durationN: plan.segment.durationN,
          sourceType: 'image_urls',
          taggingImageUrls,
          imageTimecodes: plan.frameExportOptions.timestampsMs.map(
            (ms) => framesToTimecode(plan.segment.startFrame + Math.round(ms / 1000 * RENDERER_FPS)),
          ),
          embeddingVideoUrl: embeddingVideoResult.url,
        })
      } else {
        const timelineItem = getTimelineItem(plan.fileData.timelineItemId!)
        const videoBlob = await exportTimelineItem({
          timelineItem: timelineItem || ({} as any),
          getMediaItem: this.module.getMediaItem,
          ...plan.exportOptions,
        })

        const taggingResult = await DashScopeTemporaryFileUploader.uploadBlob(
          videoBlob,
          plan.fileData.name,
          'tagging',
          (progress) => {
            const normalized = (index + progress / 200) / Math.max(1, exportResult.exportPlans.length)
            ctx.update({
              progress: Math.max(0.05, Math.min(0.95, normalized)),
              stage: 'uploading-segments',
              message: `上传打标视频 ${index + 1}/${exportResult.exportPlans.length}`,
            })
          },
        )

        if (!taggingResult.success || !taggingResult.url) {
          throw new Error(taggingResult.error || `上传打标视频分片失败: ${plan.fileData.name}`)
        }

        const embeddingResult = await DashScopeTemporaryFileUploader.uploadBlob(
          videoBlob,
          plan.fileData.name,
          'embedding',
          (progress) => {
            const normalized = (index + 0.5 + progress / 200) / Math.max(1, exportResult.exportPlans.length)
            ctx.update({
              progress: Math.max(0.05, Math.min(0.95, normalized)),
              stage: 'uploading-segments',
              message: `上传向量化视频 ${index + 1}/${exportResult.exportPlans.length}`,
            })
          },
        )

        if (!embeddingResult.success || !embeddingResult.url) {
          throw new Error(embeddingResult.error || `上传向量化视频分片失败: ${plan.fileData.name}`)
        }

        uploadedSegments.push({
          mediaItemId: mediaItem.id,
          segmentIndex: plan.segment.segmentIndex,
          startTimecode: framesToTimecode(plan.segment.startFrame),
          endTimecode: framesToTimecode(plan.segment.endFrame),
          durationN: plan.segment.durationN,
          sourceType: 'video_url',
          taggingOssUrl: taggingResult.url,
          embeddingOssUrl: embeddingResult.url,
        })
      }
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
