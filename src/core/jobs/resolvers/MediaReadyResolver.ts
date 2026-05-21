import { watch, type WatchStopHandle } from 'vue'
import type { ResourceResolver, ResolveCheckContext, ResolveContext } from '../ResourceResolver'
import { JobLogger } from '../JobLogger'
import type { UnifiedMediaItemData, MediaStatus } from '@/core/mediaitem/types'
import type { DataSourceProcessor } from '@/core/datasource/core/BaseDataSourceProcessor'
import { MediaStatusManager } from '@/core/datasource/services/MediaStatusService'

export interface MediaReadyResolverInput {
  mediaId: string
}

export interface MediaReadyResolverOptions {
  getMediaItem(mediaId: string): UnifiedMediaItemData | undefined
  getProcessor(sourceType: string): DataSourceProcessor | undefined
}

const TERMINAL_ERROR_STATUSES = new Set<MediaStatus>(['error', 'cancelled', 'missing'])

function getStageFromMediaStatus(status: MediaStatus): string {
  switch (status) {
    case 'pending':
      return 'pending'
    case 'asyncprocessing':
      return 'acquiring'
    case 'decoding':
      return 'decoding'
    case 'ready':
      return 'ready'
    case 'error':
      return 'error'
    case 'cancelled':
      return 'cancelled'
    case 'missing':
      return 'missing'
    default:
      return status
  }
}

function getMessage(mediaItem: UnifiedMediaItemData): string {
  return mediaItem.source.errorMessage || `Media ready: ${mediaItem.name}`
}

function updateFromMediaItem(
  ctx: ResolveContext<MediaReadyResolverInput>,
  mediaItem: UnifiedMediaItemData,
): void {
  ctx.update({
    stage: getStageFromMediaStatus(mediaItem.mediaStatus),
    progress: mediaItem.mediaStatus === 'ready' ? 100 : mediaItem.source.progress,
    message: getMessage(mediaItem),
  })
}

export class MediaReadyResolver
  implements ResourceResolver<MediaReadyResolverInput, UnifiedMediaItemData>
{
  readonly type = 'media-ready'
  private readonly mediaStatusManager = new MediaStatusManager()

  constructor(private readonly options: MediaReadyResolverOptions) {}

  getKey(input: MediaReadyResolverInput): string {
    return input.mediaId
  }

  async isSatisfied(
    ctx: ResolveCheckContext<MediaReadyResolverInput>,
  ): Promise<UnifiedMediaItemData | null> {
    const mediaItem = this.options.getMediaItem(ctx.input.mediaId)
    if (!mediaItem) return null

    if (mediaItem.mediaStatus === 'ready') {
      JobLogger.info('MediaReady', 'media-ready:cache-hit', {
        ...JobLogger.forNode(ctx.node),
        mediaStatus: mediaItem.mediaStatus,
      })
      return mediaItem
    }

    return null
  }

  async getDependencies(ctx: ResolveContext<MediaReadyResolverInput>) {
    const mediaItem = this.options.getMediaItem(ctx.input.mediaId)
    if (!mediaItem || mediaItem.source.type !== 'user-selected') {
      return []
    }

    return [
      {
        type: 'media-decoded',
        key: ctx.input.mediaId,
        input: { mediaId: ctx.input.mediaId },
        bindings: ctx.node.bindings,
        policy: { queue: 'local-heavy' as const },
      },
    ]
  }

  async resolve(ctx: ResolveContext<MediaReadyResolverInput>): Promise<UnifiedMediaItemData> {
    const mediaItem = this.options.getMediaItem(ctx.input.mediaId)
    if (!mediaItem) {
      throw new Error(`找不到媒体项目: ${ctx.input.mediaId}`)
    }

    if (TERMINAL_ERROR_STATUSES.has(mediaItem.mediaStatus)) {
      updateFromMediaItem(ctx, mediaItem)
      throw new Error(`媒体项目解析失败: ${mediaItem.name}, 状态: ${mediaItem.mediaStatus}`)
    }

    if (mediaItem.source.type === 'user-selected') {
      ctx.update({
        stage: 'ready',
        progress: 100,
        message: getMessage(mediaItem),
      })
      this.transitionMediaStatus(mediaItem, 'ready')
      JobLogger.info('MediaReady', 'media-ready:local-dag:succeeded', {
        ...JobLogger.forNode(ctx.node),
        mediaStatus: mediaItem.mediaStatus,
        mediaType: mediaItem.mediaType,
      })
      return mediaItem
    }

    const processor = this.options.getProcessor(mediaItem.source.type)
    if (!processor) {
      throw new Error(`找不到对应的数据源处理器: ${mediaItem.source.type}`)
    }

    updateFromMediaItem(ctx, mediaItem)

    if (mediaItem.mediaStatus === 'pending') {
      JobLogger.info('MediaReady', 'media-ready:legacy-processor:start', {
        ...JobLogger.forNode(ctx.node),
        sourceType: mediaItem.source.type,
        mediaStatus: mediaItem.mediaStatus,
      })
      processor.addTask(mediaItem)
    } else {
      JobLogger.info('MediaReady', 'media-ready:legacy-processor:wait-existing', {
        ...JobLogger.forNode(ctx.node),
        sourceType: mediaItem.source.type,
        mediaStatus: mediaItem.mediaStatus,
      })
    }

    return this.waitForReady(ctx, mediaItem)
  }

  async cancel(ctx: ResolveContext<MediaReadyResolverInput>): Promise<void> {
    const mediaItem = this.options.getMediaItem(ctx.input.mediaId)
    if (!mediaItem) return

    const processor = this.options.getProcessor(mediaItem.source.type)
    if (!processor) return

    JobLogger.info('MediaReady', 'media-ready:legacy-processor:cancel', {
      ...JobLogger.forNode(ctx.node),
      sourceType: mediaItem.source.type,
    })

    await processor.cancelTask(mediaItem.id)
  }

  private waitForReady(
    ctx: ResolveContext<MediaReadyResolverInput>,
    mediaItem: UnifiedMediaItemData,
  ): Promise<UnifiedMediaItemData> {
    return new Promise((resolve, reject) => {
      let stopped = false
      let stopWatch: WatchStopHandle | null = null

      const cleanup = () => {
        if (stopped) return
        stopped = true
        stopWatch?.()
        ctx.signal.removeEventListener('abort', onAbort)
      }

      const onAbort = () => {
        cleanup()
        reject(new Error(`Resource cancelled: ${ctx.node.id}`))
      }

      ctx.signal.addEventListener('abort', onAbort)

      stopWatch = watch(
        () => [
          mediaItem.mediaStatus,
          mediaItem.source.progress,
          mediaItem.source.errorMessage,
        ],
        () => {
          updateFromMediaItem(ctx, mediaItem)

          if (mediaItem.mediaStatus === 'ready') {
            cleanup()
            resolve(mediaItem)
            return
          }

          if (TERMINAL_ERROR_STATUSES.has(mediaItem.mediaStatus)) {
            cleanup()
            reject(new Error(`媒体项目解析失败: ${mediaItem.name}, 状态: ${mediaItem.mediaStatus}`))
          }
        },
        { immediate: true },
      )
    })
  }

  private transitionMediaStatus(mediaItem: UnifiedMediaItemData, status: 'ready'): void {
    if (mediaItem.mediaStatus === status) return
    this.mediaStatusManager.transitionTo(mediaItem, status, { resolver: this.type })
  }
}
