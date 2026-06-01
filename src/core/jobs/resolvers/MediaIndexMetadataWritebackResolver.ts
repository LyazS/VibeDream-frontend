import type { ResolveCheckContext, ResolveContext, ResourceResolver } from '../ResourceResolver'
import type { ResourceRequest } from '../ResourceTypes'
import {
  createMediaIndexMetadataWritebackRequest,
  createMediaIndexTaskCompleteRequest,
  getIndexableMediaItem,
  persistMediaItem,
  setIndexingMetadata,
  type MediaIndexMetadataWritebackInput,
  type MediaIndexMetadataWritebackResult,
  type MediaIndexTaskCompleteResult,
  type MediaIndexingModule,
  MEDIA_INDEX_METADATA_WRITEBACK_RESOURCE_TYPE,
} from './mediaIndexingShared'

export class MediaIndexMetadataWritebackResolver
  implements ResourceResolver<MediaIndexMetadataWritebackInput, MediaIndexMetadataWritebackResult>
{
  readonly type = MEDIA_INDEX_METADATA_WRITEBACK_RESOURCE_TYPE

  constructor(private readonly module: MediaIndexingModule) {}

  getKey(input: MediaIndexMetadataWritebackInput): string {
    return input.mediaId
  }

  async isSatisfied(
    ctx: ResolveCheckContext<MediaIndexMetadataWritebackInput>,
  ): Promise<MediaIndexMetadataWritebackResult | null> {
    const mediaItem = this.module.getMediaItem(ctx.input.mediaId)
    const indexing = mediaItem?.metadata?.indexing
    if (!mediaItem || !indexing) {
      return null
    }

    if (indexing.indexStatus === 'completed' || indexing.indexStatus === 'partial_failed') {
      return {
        mediaId: mediaItem.id,
        status: indexing.indexStatus,
      }
    }

    return null
  }

  async getDependencies(ctx: ResolveContext<MediaIndexMetadataWritebackInput>): Promise<ResourceRequest[]> {
    return [createMediaIndexTaskCompleteRequest(ctx.input.mediaId)]
  }

  async resolve(
    ctx: ResolveContext<MediaIndexMetadataWritebackInput>,
  ): Promise<MediaIndexMetadataWritebackResult> {
    const mediaItem = getIndexableMediaItem(this.module, ctx.input.mediaId)
    const { taskId, result } = await ctx.ensure<MediaIndexTaskCompleteResult>(
      createMediaIndexTaskCompleteRequest(ctx.input.mediaId),
    )

    const status = result.metadata?.status || (result.failed_segment_count > 0 ? 'partial_failed' : 'completed')

    setIndexingMetadata(mediaItem, {
      indexStatus: status,
      indexedAt: result.indexed_at,
      lastIndexTaskId: taskId,
      segmentCount: result.segment_count,
      failedSegmentCount: result.failed_segment_count,
      segmentSummaries: result.segment_summaries?.map((segment) => ({
        segmentIndex: segment.segment_index,
        startTimecode: segment.start_timecode,
        endTimecode: segment.end_timecode,
        title: segment.title,
        summary: segment.summary,
      })),
    })
    await persistMediaItem(mediaItem)

    ctx.update({
      progress: 1,
      stage: 'metadata-written',
      message: `索引结果已写回: ${mediaItem.name}`,
    })

    return {
      mediaId: mediaItem.id,
      status,
    }
  }
}

export function createMediaIndexMetadataWritebackResolver(
  module: MediaIndexingModule,
): MediaIndexMetadataWritebackResolver {
  return new MediaIndexMetadataWritebackResolver(module)
}

export { createMediaIndexMetadataWritebackRequest }
