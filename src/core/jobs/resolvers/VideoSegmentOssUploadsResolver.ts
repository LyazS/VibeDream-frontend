import { TimelineItemQueries } from '@/core/timelineitem/queries'
import { exportTimelineItem, exportVideoFrames } from '@/core/utils/mediaExporter'
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
import { CloudflareTemporaryFileUploader } from '@/core/utils/cloudflareTemporaryFileUploader'

export class VideoSegmentOssUploadsResolver
  implements ResourceResolver<VideoSegmentOssUploadsInput, VideoSegmentOssUploadsResult>
{
  readonly type = VIDEO_SEGMENT_OSS_UPLOADS_RESOURCE_TYPE

  constructor(private readonly module: MediaIndexingModule) {}

  getKey(input: VideoSegmentOssUploadsInput): string {
    return input.mediaId
  }

  async getDependencies(
    ctx: ResolveContext<VideoSegmentOssUploadsInput>,
  ): Promise<ResourceRequest[]> {
    return [createVideoSegmentExportsRequest(ctx.input.mediaId)]
  }

  async resolve(
    ctx: ResolveContext<VideoSegmentOssUploadsInput>,
  ): Promise<VideoSegmentOssUploadsResult> {
    const mediaItem = getIndexableMediaItem(this.module, ctx.input.mediaId)
    if (mediaItem.mediaType !== 'video') {
      throw new Error(`仅视频素材需要分片上传: ${mediaItem.id}`)
    }
    const exportResult = await ctx.ensure<VideoSegmentExportsResult>(
      createVideoSegmentExportsRequest(ctx.input.mediaId),
    )
    if (exportResult.exportPlans.length > 100) {
      throw new Error('视频分片超过索引任务的 100 段上限，请缩短素材')
    }
    const uploadedSegments: MediaIndexSegmentInput[] = []
    const getTimelineItem = (id: string) => exportResult.timelineItems[id]

    // 每个导出计划产生一份后端可识别的 segment。短片段拆为“打标帧 + 向量视频”，
    // 较长片段直接提供两份用途隔离的视频资源，保持 DashScope 模型输入契约明确。
    for (let index = 0; index < exportResult.exportPlans.length; index += 1) {
      throwIfAborted(ctx.signal)
      const plan = exportResult.exportPlans[index]
      ctx.update({
        progress: Math.max(
          0.05,
          Math.min(0.95, index / Math.max(1, exportResult.exportPlans.length)),
        ),
        stage: 'uploading-segments',
        message: `正在上传分片 ${index + 1}/${exportResult.exportPlans.length}: ${mediaItem.name}`,
      })

      if (plan.exportKind === 'frames') {
        const timelineItem = getTimelineItem(plan.fileData.timelineItemId!)
        if (!timelineItem) {
          throw new Error(`找不到时间轴项: ${plan.fileData.timelineItemId}`)
        }
        if (!TimelineItemQueries.isVideoTimelineItem(timelineItem)) {
          throw new Error(`仅视频时间轴项支持导出帧: ${plan.fileData.timelineItemId}`)
        }

        const videoBlob = await exportTimelineItem({
          timelineItem,
          getMediaItem: this.module.getMediaItem,
          ...plan.exportOptions,
        })

        // 视觉 embedding 需要保持时间连续性，因此短片段仍上传视频；
        // 视觉打标改用抽帧，以控制模型输入量并保留关键时间点。
        const embeddingVideoResult = await CloudflareTemporaryFileUploader.uploadBlob(
          videoBlob,
          { capability: 'indexing', purpose: 'embedding', fileName: plan.fileData.name },
          (progress) => {
            const normalized =
              (index + progress / 100) / Math.max(1, exportResult.exportPlans.length)
            ctx.update({
              progress: Math.max(0.05, Math.min(0.95, normalized * 0.3)),
              stage: 'uploading-segments',
              message: `上传短视频（向量化） ${index + 1}/${exportResult.exportPlans.length}`,
            })
          }, ctx.signal,
        )

        if (!embeddingVideoResult.success || !embeddingVideoResult.url) {
          throw new Error(embeddingVideoResult.error || `上传短视频分片失败: ${plan.fileData.name}`)
        }

        const frameBlobs = await exportVideoFrames({
          timelineItem,
          getMediaItem: this.module.getMediaItem,
          timestampsMs: plan.frameExportOptions.timestampsMs,
          outputWidth: plan.frameExportOptions.outputWidth,
          outputHeight: plan.frameExportOptions.outputHeight,
        })

        // 保持 frame URL 与 image_timecodes 的同序关系，Worker 才能把标签对应回视频时间轴。
        const taggingImageUrls: string[] = []
        for (let frameIdx = 0; frameIdx < frameBlobs.length; frameIdx += 1) {
          const frameName = buildFrameFileName(mediaItem.name, plan.segment.segmentIndex, frameIdx)
          const frameUploadResult = await CloudflareTemporaryFileUploader.uploadBlob(
            frameBlobs[frameIdx],
            { capability: 'indexing', purpose: 'tagging', fileName: frameName },
            (progress) => {
              const frameProgress = (frameIdx + progress / 100) / frameBlobs.length
              const normalized =
                (index + 0.3 + frameProgress * 0.7) / Math.max(1, exportResult.exportPlans.length)
              ctx.update({
                progress: Math.max(0.05, Math.min(0.95, normalized)),
                stage: 'uploading-segments',
                message: `上传帧 ${frameIdx + 1}/${frameBlobs.length} ${index + 1}/${exportResult.exportPlans.length}`,
              })
            }, ctx.signal,
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
          imageTimecodes: plan.frameExportOptions.timestampsMs.map((ms) =>
            framesToTimecode(plan.segment.startFrame + Math.round((ms / 1000) * RENDERER_FPS)),
          ),
          embeddingVideoUrl: embeddingVideoResult.url,
        })
      } else {
        const timelineItem = getTimelineItem(plan.fileData.timelineItemId!)
        if (!timelineItem) {
          throw new Error(`找不到时间轴项: ${plan.fileData.timelineItemId}`)
        }

        const videoBlob = await exportTimelineItem({
          timelineItem,
          getMediaItem: this.module.getMediaItem,
          ...plan.exportOptions,
        })

        // 两次上传携带不同 purpose，即使媒体内容相同也不能混用模型用途对应的临时资源。
        const taggingResult = await CloudflareTemporaryFileUploader.uploadBlob(
          videoBlob,
          { capability: 'indexing', purpose: 'tagging', fileName: plan.fileData.name },
          (progress) => {
            const normalized =
              (index + progress / 200) / Math.max(1, exportResult.exportPlans.length)
            ctx.update({
              progress: Math.max(0.05, Math.min(0.95, normalized)),
              stage: 'uploading-segments',
              message: `上传打标视频 ${index + 1}/${exportResult.exportPlans.length}`,
            })
          }, ctx.signal,
        )

        if (!taggingResult.success || !taggingResult.url) {
          throw new Error(taggingResult.error || `上传打标视频分片失败: ${plan.fileData.name}`)
        }

        const embeddingResult = await CloudflareTemporaryFileUploader.uploadBlob(
          videoBlob,
          { capability: 'indexing', purpose: 'embedding', fileName: plan.fileData.name },
          (progress) => {
            const normalized =
              (index + 0.5 + progress / 200) / Math.max(1, exportResult.exportPlans.length)
            ctx.update({
              progress: Math.max(0.05, Math.min(0.95, normalized)),
              stage: 'uploading-segments',
              message: `上传向量化视频 ${index + 1}/${exportResult.exportPlans.length}`,
            })
          }, ctx.signal,
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
