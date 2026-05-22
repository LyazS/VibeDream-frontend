import type { UnifiedMediaItemData } from '@/core/mediaitem/types'
import type { UnifiedMediaModule } from '@/core/modules/UnifiedMediaModule'
import type { ResolveCheckContext, ResolveContext, ResourceResolver } from '../ResourceResolver'
import type { ResourcePolicy, ResourceRequest } from '../ResourceTypes'
import { createMediaFileAvailableRequest } from './MediaFileAvailableResolver'

export const MEDIA_DECODED_RESOURCE_TYPE = 'media-decoded'

export interface MediaDecodedInput {
  mediaId: string
}

export type MediaDecodedResult = UnifiedMediaItemData

type MediaDecodedModule = Pick<
  UnifiedMediaModule,
  | 'getMediaItem'
  | 'hasPreparedMediaFile'
  | 'decodePreparedMediaFileDirectly'
  | 'waitForMediaItemReady'
  | 'cancelMediaProcessing'
>

/**
 * 解码媒体资源。
 *
 * 它依赖 MediaFileAvailable，执行完成后 media item 应进入 ready，并填充
 * Bunny runtime、duration、thumbnail 等现有处理器产生的运行态数据。
 */
export class MediaDecodedResolver
  implements ResourceResolver<MediaDecodedInput, MediaDecodedResult>
{
  readonly type = MEDIA_DECODED_RESOURCE_TYPE

  constructor(private readonly mediaModule: MediaDecodedModule) {}

  getKey(input: MediaDecodedInput): string {
    return input.mediaId
  }

  async isSatisfied(
    ctx: ResolveCheckContext<MediaDecodedInput>,
  ): Promise<MediaDecodedResult | null> {
    const mediaItem = this.mediaModule.getMediaItem(ctx.input.mediaId)

    if (!mediaItem) {
      return null
    }

    return mediaItem.mediaStatus === 'ready' ? mediaItem : null
  }

  async getDependencies(ctx: ResolveContext<MediaDecodedInput>): Promise<ResourceRequest[]> {
    const mediaItem = this.mediaModule.getMediaItem(ctx.input.mediaId)

    if (!mediaItem || mediaItem.mediaStatus === 'ready') {
      return []
    }

    return [createMediaFileAvailableRequest(ctx.input.mediaId)]
  }

  async resolve(ctx: ResolveContext<MediaDecodedInput>): Promise<MediaDecodedResult> {
    const mediaItem = this.getExistingMediaItem(ctx.input.mediaId)

    ctx.update({
      progress: normalizeProgress(mediaItem.source.progress),
      stage: 'decoding',
      message: `Decoding media: ${mediaItem.name}`,
    })

    if (
      mediaItem.mediaStatus === 'pending' ||
      this.mediaModule.hasPreparedMediaFile(ctx.input.mediaId)
    ) {
      await this.mediaModule.decodePreparedMediaFileDirectly(mediaItem)
    } else if (
      mediaItem.mediaStatus === 'asyncprocessing' ||
      mediaItem.mediaStatus === 'decoding'
    ) {
      await this.waitForReady(ctx, mediaItem)
    }

    const decodedMediaItem = this.getExistingMediaItem(ctx.input.mediaId)
    if (decodedMediaItem.mediaStatus !== 'ready') {
      throw new Error(`Media item did not become ready: ${decodedMediaItem.name}`)
    }

    ctx.update({
      progress: 1,
      stage: 'decoded',
      message: `Media decoded: ${decodedMediaItem.name}`,
    })

    return decodedMediaItem
  }

  async cancel(ctx: ResolveContext<MediaDecodedInput>): Promise<void> {
    await this.mediaModule.cancelMediaProcessing(ctx.input.mediaId)
  }

  private async waitForReady(
    ctx: ResolveContext<MediaDecodedInput>,
    mediaItem: UnifiedMediaItemData,
  ): Promise<void> {
    const waitPromise = this.mediaModule.waitForMediaItemReady(mediaItem.id)
    const abortPromise = new Promise<never>((_, reject) => {
      ctx.signal.addEventListener(
        'abort',
        () => reject(new DOMException('Media decode cancelled', 'AbortError')),
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

    if (isFailedMediaStatus(mediaItem.mediaStatus)) {
      throw new Error(`Media item is ${mediaItem.mediaStatus}: ${mediaItem.name}`)
    }

    return mediaItem
  }
}

export function createMediaDecodedResolver(mediaModule: MediaDecodedModule): MediaDecodedResolver {
  return new MediaDecodedResolver(mediaModule)
}

export function createMediaDecodedRequest(
  mediaId: string,
  policy?: ResourcePolicy,
): ResourceRequest<MediaDecodedInput> {
  return {
    type: MEDIA_DECODED_RESOURCE_TYPE,
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

function normalizeProgress(progress: number | undefined): number {
  if (typeof progress !== 'number') {
    return 0
  }

  return Math.max(0, Math.min(1, progress / 100))
}
