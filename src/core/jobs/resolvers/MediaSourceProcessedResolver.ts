import type { UnifiedMediaItemData } from '@/core/mediaitem/types'
import type { UnifiedMediaModule } from '@/core/modules/UnifiedMediaModule'
import type { ResolveCheckContext, ResolveContext, ResourceResolver } from '../ResourceResolver'
import type { ResourcePolicy, ResourceRequest } from '../ResourceTypes'
import { createMediaDecodedRequest } from './MediaDecodedResolver'

export const MEDIA_SOURCE_PROCESSED_RESOURCE_TYPE = 'media-source-processed'

export interface MediaSourceProcessedInput {
  mediaId: string
}

export interface MediaSourceProcessedResult {
  mediaId: string
  status: 'ready'
}

type MediaSourceProcessedModule = Pick<
  UnifiedMediaModule,
  'getMediaItem' | 'cancelMediaProcessing'
>

/**
 * 处理媒体数据源，让 media item 从 pending/processing 走到 ready。
 *
 * 这是 MediaReady 下面的兼容聚合子资源。当前继续向下声明：
 * MediaSourceProcessed(mediaId)
 *   -> MediaDecoded(mediaId)
 */
export class MediaSourceProcessedResolver
  implements ResourceResolver<MediaSourceProcessedInput, MediaSourceProcessedResult>
{
  readonly type = MEDIA_SOURCE_PROCESSED_RESOURCE_TYPE

  constructor(private readonly mediaModule: MediaSourceProcessedModule) {}

  getKey(input: MediaSourceProcessedInput): string {
    return input.mediaId
  }

  async isSatisfied(
    ctx: ResolveCheckContext<MediaSourceProcessedInput>,
  ): Promise<MediaSourceProcessedResult | null> {
    const mediaItem = this.mediaModule.getMediaItem(ctx.input.mediaId)

    if (!mediaItem) {
      return null
    }

    return isMediaSourceProcessed(mediaItem) ? toResult(mediaItem) : null
  }

  async getDependencies(
    ctx: ResolveContext<MediaSourceProcessedInput>,
  ): Promise<ResourceRequest[]> {
    const mediaItem = this.mediaModule.getMediaItem(ctx.input.mediaId)

    if (!mediaItem || isMediaSourceProcessed(mediaItem)) {
      return []
    }

    return [createMediaDecodedRequest(ctx.input.mediaId)]
  }

  async resolve(
    ctx: ResolveContext<MediaSourceProcessedInput>,
  ): Promise<MediaSourceProcessedResult> {
    const mediaItem = this.getExistingMediaItem(ctx.input.mediaId)

    ctx.update({
      progress: normalizeProgress(mediaItem.source.progress),
      stage: mediaItem.mediaStatus,
      message: `Processing media source: ${mediaItem.name}`,
    })

    const processedMediaItem = this.getExistingMediaItem(ctx.input.mediaId)

    if (!isMediaSourceProcessed(processedMediaItem)) {
      throw new Error(`Media source did not become ready: ${processedMediaItem.name}`)
    }

    ctx.update({
      progress: 1,
      stage: 'ready',
      message: `Media source processed: ${processedMediaItem.name}`,
    })

    return toResult(processedMediaItem)
  }

  async cancel(ctx: ResolveContext<MediaSourceProcessedInput>): Promise<void> {
    await this.mediaModule.cancelMediaProcessing(ctx.input.mediaId)
  }
  private getExistingMediaItem(mediaId: string): UnifiedMediaItemData {
    const mediaItem = this.mediaModule.getMediaItem(mediaId)

    if (!mediaItem) {
      throw new Error(`Media item not found: ${mediaId}`)
    }

    if (isFailedMediaStatus(mediaItem.mediaStatus)) {
      throw new Error(`Media item is ${mediaItem.mediaStatus}: ${mediaItem.name}`)
    }

    return mediaItem
  }
}

export function createMediaSourceProcessedResolver(
  mediaModule: MediaSourceProcessedModule,
): MediaSourceProcessedResolver {
  return new MediaSourceProcessedResolver(mediaModule)
}

export function createMediaSourceProcessedRequest(
  mediaId: string,
  policy?: ResourcePolicy,
): ResourceRequest<MediaSourceProcessedInput> {
  return {
    type: MEDIA_SOURCE_PROCESSED_RESOURCE_TYPE,
    key: mediaId,
    input: {
      mediaId,
    },
    policy: {
      queue: 'local-heavy',
      ...policy,
    },
  }
}

function isFailedMediaStatus(status: UnifiedMediaItemData['mediaStatus']): boolean {
  return status === 'error' || status === 'cancelled' || status === 'missing'
}

function toResult(mediaItem: UnifiedMediaItemData): MediaSourceProcessedResult {
  return {
    mediaId: mediaItem.id,
    status: 'ready',
  }
}

function normalizeProgress(progress: number | undefined): number {
  if (typeof progress !== 'number') {
    return 0
  }

  return Math.max(0, Math.min(1, progress / 100))
}

function isMediaSourceProcessed(mediaItem: UnifiedMediaItemData): boolean {
  return Boolean(mediaItem.runtime.bunny) && typeof mediaItem.duration === 'number'
}
