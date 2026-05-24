import type { UnifiedMediaItemData } from '@/core/mediaitem/types'
import type { UnifiedMediaModule } from '@/core/modules/UnifiedMediaModule'
import type { ResolveCheckContext, ResolveContext, ResourceResolver } from '../ResourceResolver'
import type { ResourcePolicy, ResourceRequest } from '../ResourceTypes'
import { createMediaSourceProcessedRequest } from './MediaSourceProcessedResolver'

export const MEDIA_READY_RESOURCE_TYPE = 'media-ready'

export interface MediaReadyInput {
  mediaId: string
}

export interface MediaReadyResult {
  mediaId: string
  status: 'ready'
}

type MediaReadyModule = Pick<
  UnifiedMediaModule,
  'getMediaItem' | 'cancelMediaProcessing'
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
    console.log('[MediaReadyResolver][isSatisfied]', {
      mediaId: ctx.input.mediaId,
      exists: !!mediaItem,
      mediaStatus: mediaItem?.mediaStatus,
      name: mediaItem?.name,
    })

    if (!mediaItem) {
      return null
    }

    return mediaItem.mediaStatus === 'ready' ? toResult(mediaItem) : null
  }

  async getDependencies(ctx: ResolveContext<MediaReadyInput>): Promise<ResourceRequest[]> {
    const mediaItem = this.mediaModule.getMediaItem(ctx.input.mediaId)
    console.log('[MediaReadyResolver][getDependencies]', {
      mediaId: ctx.input.mediaId,
      exists: !!mediaItem,
      mediaStatus: mediaItem?.mediaStatus,
    })

    if (!mediaItem || mediaItem.mediaStatus === 'ready') {
      return []
    }

    return [createMediaSourceProcessedRequest(ctx.input.mediaId)]
  }

  async resolve(ctx: ResolveContext<MediaReadyInput>): Promise<MediaReadyResult> {
    const mediaItem = this.getExistingMediaItem(ctx.input.mediaId)
    console.log('[MediaReadyResolver][resolve] enter', {
      mediaId: ctx.input.mediaId,
      mediaStatus: mediaItem.mediaStatus,
      name: mediaItem.name,
    })

    if (mediaItem.mediaStatus === 'ready') {
      ctx.update({
        progress: 1,
        stage: 'ready',
        message: `Media ready: ${mediaItem.name}`,
      })
      return toResult(mediaItem)
    }

    if (!isMediaReadyToFinalize(mediaItem)) {
      throw new Error(`Media item is not ready to finalize: ${mediaItem.name}`)
    }

    mediaItem.mediaStatus = 'ready'

    const readyMediaItem = this.getExistingMediaItem(ctx.input.mediaId)
    if (readyMediaItem.mediaStatus !== 'ready') {
      throw new Error(`Media item did not become ready: ${readyMediaItem.name}`)
    }
    console.log('[MediaReadyResolver][resolve] ready', {
      mediaId: readyMediaItem.id,
      mediaStatus: readyMediaItem.mediaStatus,
      name: readyMediaItem.name,
    })

    ctx.update({
      progress: 1,
      stage: 'ready',
      message: `Media ready: ${readyMediaItem.name}`,
    })

    return toResult(readyMediaItem)
  }

  async cancel(ctx: ResolveContext<MediaReadyInput>): Promise<void> {
    await this.mediaModule.cancelMediaProcessing(ctx.input.mediaId)
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

function toResult(mediaItem: UnifiedMediaItemData): MediaReadyResult {
  return {
    mediaId: mediaItem.id,
    status: 'ready',
  }
}

function isMediaReadyToFinalize(mediaItem: UnifiedMediaItemData): boolean {
  return Boolean(mediaItem.runtime.bunny) && typeof mediaItem.duration === 'number'
}
