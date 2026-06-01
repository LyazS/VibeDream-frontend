import { BizyairFileUploader } from '@/core/utils/bizyairFileUploader'
import { exportVideoFrames } from '@/core/utils/mediaExporter'
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

        const videoUploadResult = await BizyairFileUploader.uploadFile(
          plan.fileData,
          this.module.getMediaItem,
          getTimelineItem,
          (stage, progress) => {
            const normalized = (index + progress / 100) / Math.max(1, exportResult.exportPlans.length)
            ctx.update({
              progress: Math.max(0.05, Math.min(0.95, normalized * 0.5)),
              stage: 'uploading-segments',
              message: `${stage} (视频) ${index + 1}/${exportResult.exportPlans.length}`,
            })
          },
          plan.exportOptions,
        )

        if (!videoUploadResult.success || !videoUploadResult.url) {
          throw new Error(videoUploadResult.error || `上传短视频分片失败: ${plan.fileData.name}`)
        }

        const frameBlobs = await exportVideoFrames({
          timelineItem: timelineItem as any,
          getMediaItem: this.module.getMediaItem,
          timestampsMs: plan.frameExportOptions.timestampsMs,
          outputWidth: plan.frameExportOptions.outputWidth,
          outputHeight: plan.frameExportOptions.outputHeight,
        })

        const imageUrls: string[] = []
        for (let frameIdx = 0; frameIdx < frameBlobs.length; frameIdx += 1) {
          const frameName = buildFrameFileName(mediaItem.name, plan.segment.segmentIndex, frameIdx)
          const frameUploadResult = await BizyairFileUploader.uploadBlob(
            frameBlobs[frameIdx],
            frameName,
            (stage, progress) => {
              const frameProgress = (frameIdx + progress / 100) / frameBlobs.length
              const normalized = (index + 0.5 + frameProgress * 0.5) / Math.max(1, exportResult.exportPlans.length)
              ctx.update({
                progress: Math.max(0.05, Math.min(0.95, normalized)),
                stage: 'uploading-segments',
                message: `${stage} (帧 ${frameIdx + 1}/${frameBlobs.length}) ${index + 1}/${exportResult.exportPlans.length}`,
              })
            },
          )

          if (!frameUploadResult.success || !frameUploadResult.url) {
            throw new Error(frameUploadResult.error || `上传帧失败: ${frameName}`)
          }

          imageUrls.push(frameUploadResult.url)
        }

        uploadedSegments.push({
          mediaItemId: mediaItem.id,
          segmentIndex: plan.segment.segmentIndex,
          startTimecode: framesToTimecode(plan.segment.startFrame),
          endTimecode: framesToTimecode(plan.segment.endFrame),
          durationN: plan.segment.durationN,
          sourceType: 'image_urls',
          imageUrls,
          imageTimecodes: plan.frameExportOptions.timestampsMs.map(
            (ms) => framesToTimecode(plan.segment.startFrame + Math.round(ms / 1000 * RENDERER_FPS)),
          ),
          embeddingVideoUrl: videoUploadResult.url,
        })
      } else {
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
          startTimecode: framesToTimecode(plan.segment.startFrame),
          endTimecode: framesToTimecode(plan.segment.endFrame),
          durationN: plan.segment.durationN,
          sourceType: 'video_url',
          ossUrl: uploadResult.url,
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
