import type { ResolveContext, ResourceResolver } from '../ResourceResolver'
import type { ResourceRequest } from '../ResourceTypes'
import {
  buildIndexingExportSize,
  buildSegmentFileName,
  createTemporaryVideoTimelineItem,
  createVideoSceneSegmentsRequest,
  createVideoSegmentExportsRequest,
  getVideoMediaItem,
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
      exportPlans.push({
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
