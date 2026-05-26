import type { UnifiedMediaItemData, MediaType } from '@/core/mediaitem/types'
import type { UnifiedMediaModule } from '@/core/modules/UnifiedMediaModule'
import type { ResolveCheckContext, ResolveContext, ResourceResolver } from '../ResourceResolver'
import type { ResourcePolicy, ResourceRequest } from '../ResourceTypes'

export const MEDIA_FILE_AVAILABLE_RESOURCE_TYPE = 'media-file-available'

export interface MediaFileAvailableInput {
  mediaId: string
}

export interface MediaFileAvailableResult {
  mediaId: string
  mediaType: MediaType | 'unknown'
}

type MediaFileAvailableModule = Pick<UnifiedMediaModule, 'getMediaItem' | 'prepareMediaFileDirectly'>

/**
 * 准备媒体文件资源。
 *
 * 注意：这里不把 File 放进 ResourceNode.result，避免任务图长期持有大对象。
 * File 会短期缓存在 UnifiedMediaModule 内部，随后由 MediaDecoded 消费并清理。
 */
export class MediaFileAvailableResolver
  implements ResourceResolver<MediaFileAvailableInput, MediaFileAvailableResult>
{
  readonly type = MEDIA_FILE_AVAILABLE_RESOURCE_TYPE

  constructor(private readonly mediaModule: MediaFileAvailableModule) {}

  getKey(input: MediaFileAvailableInput): string {
    return input.mediaId
  }

  async isSatisfied(
    ctx: ResolveCheckContext<MediaFileAvailableInput>,
  ): Promise<MediaFileAvailableResult | null> {
    const mediaItem = this.mediaModule.getMediaItem(ctx.input.mediaId)

    if (!mediaItem) {
      return null
    }

    if (mediaItem.mediaStatus === 'ready' || mediaItem.mediaStatus === 'decoding') {
      return toResult(mediaItem)
    }

    return null
  }

  async resolve(ctx: ResolveContext<MediaFileAvailableInput>): Promise<MediaFileAvailableResult> {
    const mediaItem = this.getExistingMediaItem(ctx.input.mediaId)

    ctx.update({
      progress: normalizeProgress(mediaItem.source.progress),
      stage: 'file-available',
      message: `Preparing media file: ${mediaItem.name}`,
    })

    if (mediaItem.mediaStatus !== 'ready' && mediaItem.mediaStatus !== 'decoding') {
      await this.mediaModule.prepareMediaFileDirectly(mediaItem)
    }

    const preparedMediaItem = this.getExistingMediaItem(ctx.input.mediaId)

    ctx.update({
      progress: 1,
      stage: 'file-available',
      message: `Media file available: ${preparedMediaItem.name}`,
    })

    return toResult(preparedMediaItem)
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

export function createMediaFileAvailableResolver(
  mediaModule: MediaFileAvailableModule,
): MediaFileAvailableResolver {
  return new MediaFileAvailableResolver(mediaModule)
}

export function createMediaFileAvailableRequest(
  mediaId: string,
  policy?: ResourcePolicy,
): ResourceRequest<MediaFileAvailableInput> {
  return {
    type: MEDIA_FILE_AVAILABLE_RESOURCE_TYPE,
    key: mediaId,
    input: {
      mediaId,
    },
    policy: {
      queue: 'background',
      ...policy,
    },
  }
}

function toResult(mediaItem: UnifiedMediaItemData): MediaFileAvailableResult {
  return {
    mediaId: mediaItem.id,
    mediaType: mediaItem.mediaType,
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
