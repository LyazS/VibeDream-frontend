import type { ResourceResolver, ResolveCheckContext, ResolveContext } from '../ResourceResolver'
import { JobLogger } from '../JobLogger'
import { MediaStatusManager } from '@/core/datasource/services/MediaStatusService'
import { DataSourceHelpers } from '@/core/datasource/core/DataSourceHelpers'
import { RuntimeStateActions } from '@/core/datasource/core/BaseDataSource'
import { BunnyProcessor } from '@/core/bunnyUtils/BunnyProcessor'
import { globalMetaFileManager } from '@/core/managers/media/globalMetaFileManager'
import type { UnifiedMediaItemData } from '@/core/mediaitem/types'
import type {
  MediaDecodedInput,
  MediaFileAvailableResult,
  MediaResolverOptions,
} from './MediaResolverTypes'

export class MediaDecodedResolver
  implements ResourceResolver<MediaDecodedInput, UnifiedMediaItemData>
{
  readonly type = 'media-decoded'
  private readonly mediaStatusManager = new MediaStatusManager()
  private readonly bunnyProcessor = new BunnyProcessor()

  constructor(private readonly options: MediaResolverOptions) {}

  getKey(input: MediaDecodedInput): string {
    return input.mediaId
  }

  async isSatisfied(
    ctx: ResolveCheckContext<MediaDecodedInput>,
  ): Promise<UnifiedMediaItemData | null> {
    const mediaItem = this.options.getMediaItem(ctx.input.mediaId)
    if (!mediaItem) return null

    if (mediaItem.runtime.bunny && mediaItem.duration) {
      JobLogger.info('MediaReady', 'media-decoded:cache-hit', {
        ...JobLogger.forNode(ctx.node),
        mediaStatus: mediaItem.mediaStatus,
        mediaType: mediaItem.mediaType,
      })
      return mediaItem
    }

    return null
  }

  async getDependencies(ctx: ResolveContext<MediaDecodedInput>) {
    return [
      {
        type: 'media-file-available',
        key: ctx.input.mediaId,
        input: { mediaId: ctx.input.mediaId },
        bindings: ctx.node.bindings,
        policy: { queue: 'local-heavy' as const },
      },
    ]
  }

  async resolve(ctx: ResolveContext<MediaDecodedInput>): Promise<UnifiedMediaItemData> {
    const mediaItem = this.options.getMediaItem(ctx.input.mediaId)
    if (!mediaItem) {
      throw new Error(`找不到媒体项目: ${ctx.input.mediaId}`)
    }

    if (mediaItem.source.type !== 'user-selected') {
      throw new Error(`media-decoded 暂只支持 user-selected: ${mediaItem.source.type}`)
    }

    const fileAvailable = await ctx.ensure<MediaFileAvailableResult>({
      type: 'media-file-available',
      key: ctx.input.mediaId,
      input: { mediaId: ctx.input.mediaId },
      bindings: ctx.node.bindings,
      policy: { queue: 'local-heavy' },
    })

    try {
      if (fileAvailable.mediaType !== null) {
        mediaItem.mediaType = fileAvailable.mediaType
      }

      this.transitionMediaStatus(mediaItem, 'decoding')
      ctx.update({
        stage: 'decode',
        progress: 10,
        message: `Decoding media: ${mediaItem.name}`,
      })

      const bunnyResult = await this.bunnyProcessor.processMedia(mediaItem, fileAvailable.file)
      mediaItem.runtime.bunny = bunnyResult.bunnyObjects
      mediaItem.duration = Number(bunnyResult.durationN)

      if (DataSourceHelpers.isUserCreate(mediaItem.source)) {
        await globalMetaFileManager.saveMetaFile(mediaItem)
      }

      ctx.update({
        stage: 'decoded',
        progress: 100,
        message: `Media decoded: ${mediaItem.name}`,
      })

      JobLogger.info('MediaReady', 'media-decoded:succeeded', {
        ...JobLogger.forNode(ctx.node),
        mediaStatus: mediaItem.mediaStatus,
        mediaType: mediaItem.mediaType,
      })

      return mediaItem
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : '媒体解码失败'
      RuntimeStateActions.setError(mediaItem.source, errorMessage)
      this.transitionMediaStatus(mediaItem, 'error')
      throw error
    }
  }

  private transitionMediaStatus(
    mediaItem: UnifiedMediaItemData,
    status: 'decoding' | 'error',
  ): void {
    if (mediaItem.mediaStatus === status) return
    this.mediaStatusManager.transitionTo(mediaItem, status, { resolver: this.type })
  }
}
