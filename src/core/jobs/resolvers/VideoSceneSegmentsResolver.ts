import { cleanupTimelineItemBunny, setupTimelineItemBunny } from '@/core/bunnyUtils/timelineItemSetup'
import { detectSceneTransNetV2 } from '@/core/utils/scene-detector-transnetv2'
import type { ResolveContext, ResourceResolver } from '../ResourceResolver'
import type { ResourceRequest } from '../ResourceTypes'
import { createMediaReadyRequest } from './MediaReadyResolver'
import {
  buildSegmentsFromBoundaries,
  createTemporaryVideoTimelineItem,
  createVideoSceneSegmentsRequest,
  getVideoMediaItem,
  type MediaIndexingModule,
  type VideoSceneSegmentsInput,
  type VideoSceneSegmentsResult,
  VIDEO_SCENE_SEGMENTS_RESOURCE_TYPE,
} from './mediaIndexingShared'

export class VideoSceneSegmentsResolver
  implements ResourceResolver<VideoSceneSegmentsInput, VideoSceneSegmentsResult>
{
  readonly type = VIDEO_SCENE_SEGMENTS_RESOURCE_TYPE

  constructor(private readonly module: MediaIndexingModule) {}

  getKey(input: VideoSceneSegmentsInput): string {
    return input.mediaId
  }

  async getDependencies(ctx: ResolveContext<VideoSceneSegmentsInput>): Promise<ResourceRequest[]> {
    return [createMediaReadyRequest(ctx.input.mediaId)]
  }

  async resolve(ctx: ResolveContext<VideoSceneSegmentsInput>): Promise<VideoSceneSegmentsResult> {
    const mediaItem = getVideoMediaItem(this.module, ctx.input.mediaId)
    if (mediaItem.mediaStatus !== 'ready' || typeof mediaItem.duration !== 'number') {
      throw new Error(`视频素材尚未就绪: ${mediaItem.name}`)
    }

    const timelineItem = createTemporaryVideoTimelineItem(mediaItem, 0, mediaItem.duration)
    await setupTimelineItemBunny(timelineItem, mediaItem)

    try {
      ctx.update({
        progress: 0.05,
        stage: 'detecting-scenes',
        message: `正在分析镜头切分: ${mediaItem.name}`,
      })

      const boundaries = await detectSceneTransNetV2(timelineItem, {
        threshold: 0.5,
        minShotFrames: 15,
        signal: ctx.signal,
        onProgress: (event) => {
          ctx.update({
            progress: Math.max(0.05, Math.min(0.95, event.current / event.total)),
            stage: event.stage,
            message: `正在切分镜头: ${mediaItem.name}`,
          })
        },
      })

      const segments = buildSegmentsFromBoundaries(mediaItem.id, mediaItem.duration, boundaries)
      ctx.update({
        progress: 1,
        stage: 'scene-segments-ready',
        message: `镜头切分完成，共 ${segments.length} 段`,
      })

      return {
        mediaId: mediaItem.id,
        segments,
      }
    } finally {
      await cleanupTimelineItemBunny(timelineItem)
    }
  }
}

export function createVideoSceneSegmentsResolver(
  module: MediaIndexingModule,
): VideoSceneSegmentsResolver {
  return new VideoSceneSegmentsResolver(module)
}

export { createVideoSceneSegmentsRequest }
