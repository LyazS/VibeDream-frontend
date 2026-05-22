import type { UnifiedMediaItemData } from '@/core/mediaitem/types'
import type { UnifiedMediaModule } from '@/core/modules/UnifiedMediaModule'
import type { ResolveCheckContext, ResolveContext, ResourceResolver } from '../ResourceResolver'
import type { ResourcePolicy, ResourceRequest } from '../ResourceTypes'
import { createMediaSourceProcessedRequest } from './MediaSourceProcessedResolver'

export const MEDIA_READY_RESOURCE_TYPE = 'media-ready'

export interface MediaReadyInput {
  mediaId: string
}

export type MediaReadyResult = UnifiedMediaItemData

type MediaReadyModule = Pick<
  UnifiedMediaModule,
  'getMediaItem' | 'waitForMediaItemReady' | 'cancelMediaProcessing'
>

/**
 * 第一版真实业务 resolver：让一个 media item 达到 ready。
 *
 * 当前资源图：
 * MediaReady(mediaId)
 *   -> MediaSourceProcessed(mediaId)
 *
 * MediaReady 只表达业务入口语义：调用方需要一个可用媒体。具体处理放到
 * MediaSourceProcessed，后续可以继续拆 MediaFileAvailable / MediaDecoded。
 */
export class MediaReadyResolver implements ResourceResolver<MediaReadyInput, MediaReadyResult> {
  readonly type = MEDIA_READY_RESOURCE_TYPE

  constructor(private readonly mediaModule: MediaReadyModule) {}

  getKey(input: MediaReadyInput): string {
    return input.mediaId
  }

  async isSatisfied(ctx: ResolveCheckContext<MediaReadyInput>): Promise<MediaReadyResult | null> {
    const mediaItem = this.mediaModule.getMediaItem(ctx.input.mediaId)

    if (!mediaItem) {
      return null
    }

    if (mediaItem.mediaStatus === 'ready') {
      return mediaItem
    }

    return null
  }

  async getDependencies(ctx: ResolveContext<MediaReadyInput>): Promise<ResourceRequest[]> {
    const mediaItem = this.mediaModule.getMediaItem(ctx.input.mediaId)

    if (!mediaItem || mediaItem.mediaStatus === 'ready') {
      return []
    }

    return [createMediaSourceProcessedRequest(ctx.input.mediaId)]
  }

  async resolve(ctx: ResolveContext<MediaReadyInput>): Promise<MediaReadyResult> {
    const mediaItem = this.getExistingMediaItem(ctx.input.mediaId)

    if (mediaItem.mediaStatus === 'ready') {
      ctx.update({
        progress: 1,
        stage: 'ready',
        message: `Media ready: ${mediaItem.name}`,
      })
      return mediaItem
    }

    await this.waitForReady(ctx, mediaItem)

    const readyMediaItem = this.getExistingMediaItem(ctx.input.mediaId)
    if (readyMediaItem.mediaStatus !== 'ready') {
      throw new Error(`Media item did not become ready: ${readyMediaItem.name}`)
    }

    ctx.update({
      progress: 1,
      stage: 'ready',
      message: `Media ready: ${readyMediaItem.name}`,
    })

    return readyMediaItem
  }

  async cancel(ctx: ResolveContext<MediaReadyInput>): Promise<void> {
    await this.mediaModule.cancelMediaProcessing(ctx.input.mediaId)
  }

  private async waitForReady(
    ctx: ResolveContext<MediaReadyInput>,
    mediaItem: UnifiedMediaItemData,
  ): Promise<void> {
    const waitPromise = this.mediaModule.waitForMediaItemReady(mediaItem.id)
    const abortPromise = new Promise<never>((_, reject) => {
      ctx.signal.addEventListener(
        'abort',
        () => reject(new DOMException('Media ready cancelled', 'AbortError')),
        { once: true },
      )
    })

    await Promise.race([waitPromise, abortPromise])
  }

  private getExistingMediaItem(mediaId: string): UnifiedMediaItemData {
    const mediaItem = this.mediaModule.getMediaItem(mediaId)

    if (!mediaItem) {
      throw new Error(`Media item not found: ${mediaId}`)
    }

    return mediaItem
  }
}

export function createMediaReadyResolver(mediaModule: MediaReadyModule): MediaReadyResolver {
  return new MediaReadyResolver(mediaModule)
}

export function createMediaReadyRequest(
  mediaId: string,
  policy?: ResourcePolicy,
): ResourceRequest<MediaReadyInput> {
  return {
    type: MEDIA_READY_RESOURCE_TYPE,
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
