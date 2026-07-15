import type { ResolveContext, ResourceResolver } from '../ResourceResolver'
import type { ResourceRequest } from '../ResourceTypes'
import {
  buildIndexingExportSize,
  buildSegmentFileName,
  computeFrameTimestampsMs,
  createTemporaryVideoTimelineItem,
  createVideoSceneSegmentsRequest,
  createVideoSegmentExportsRequest,
  getVideoMediaItem,
  isShortSegment,
  type MediaIndexingModule,
  type VideoSegmentExportPlan,
  type VideoSegmentExportsInput,
  type VideoSegmentExportsResult,
  type VideoSceneSegmentsResult,
  VIDEO_SEGMENT_EXPORTS_RESOURCE_TYPE,
} from './mediaIndexingShared'

export class VideoSegmentExportsResolver
  implements ResourceResolver<VideoSegmentExportsInput, VideoSegmentExportsResult>
{
  readonly type = VIDEO_SEGMENT_EXPORTS_RESOURCE_TYPE

  constructor(private readonly module: MediaIndexingModule) {}

  getKey(input: VideoSegmentExportsInput): string {
    return input.mediaId
  }

  async getDependencies(ctx: ResolveContext<VideoSegmentExportsInput>): Promise<ResourceRequest[]> {
    return [createVideoSceneSegmentsRequest(ctx.input.mediaId)]
  }

  async resolve(ctx: ResolveContext<VideoSegmentExportsInput>): Promise<VideoSegmentExportsResult> {
    const mediaItem = getVideoMediaItem(this.module, ctx.input.mediaId)
    const { segments } = await ctx.ensure<VideoSceneSegmentsResult>(
      createVideoSceneSegmentsRequest(ctx.input.mediaId),
    )

    const exportPlans: VideoSegmentExportPlan[] = []
    const timelineItems: Record<string, ReturnType<typeof createTemporaryVideoTimelineItem>> = {}
    const exportSize = buildIndexingExportSize(mediaItem)

    for (const segment of segments) {
      const timelineItem = createTemporaryVideoTimelineItem(
        mediaItem,
        segment.startFrame,
        segment.endFrame,
        `${mediaItem.id}:segment:${segment.segmentIndex}`,
      )
      timelineItems[timelineItem.id] = timelineItem

      if (isShortSegment(segment.durationN)) {
        const { frameCount, timestampsMs } = computeFrameTimestampsMs(segment.durationN)
        const fileData = {
          __type__: 'FileData' as const,
          name: buildSegmentFileName(mediaItem.name, segment.segmentIndex),
          mediaType: 'video' as const,
          timelineItemId: timelineItem.id,
          source: 'timeline-item' as const,
        }
        exportPlans.push({
          exportKind: 'frames',
          segment,
          frameExportOptions: {
            timestampsMs,
            frameCount,
            outputWidth: exportSize?.outputWidth,
            outputHeight: exportSize?.outputHeight,
          },
          fileData,
          exportOptions: exportSize,
        })
      } else {
        exportPlans.push({
          exportKind: 'video',
          segment,
          fileData: {
            __type__: 'FileData',
            name: buildSegmentFileName(mediaItem.name, segment.segmentIndex),
            mediaType: 'video',
            timelineItemId: timelineItem.id,
            source: 'timeline-item',
          },
          exportOptions: exportSize,
        })
      }
    }

    ctx.update({
      progress: 1,
      stage: 'segment-export-plans-ready',
      message: `已生成 ${exportPlans.length} 个分片导出计划`,
    })

    return {
      mediaId: mediaItem.id,
      exportPlans,
      timelineItems,
    }
  }
}

export function createVideoSegmentExportsResolver(
  module: MediaIndexingModule,
): VideoSegmentExportsResolver {
  return new VideoSegmentExportsResolver(module)
}

export { createVideoSegmentExportsRequest }
