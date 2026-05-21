import type { ResourceResolver, ResolveCheckContext, ResolveContext } from '../ResourceResolver'
import { JobLogger } from '../JobLogger'
import { DataSourceHelpers } from '@/core/datasource/core/DataSourceHelpers'
import { RuntimeStateActions } from '@/core/datasource/core/BaseDataSource'
import { MediaStatusManager } from '@/core/datasource/services/MediaStatusService'
import type { UserSelectedFileSourceData } from '@/core/datasource/providers/user-selected/UserSelectedFileSource'
import { globalMetaFileManager } from '@/core/managers/media/globalMetaFileManager'
import { validateFile } from '@/core/utils/mediaTypeDetector'
import type {
  MediaFileAvailableInput,
  MediaFileAvailableResult,
  MediaResolverOptions,
} from './MediaResolverTypes'

export class MediaFileAvailableResolver
  implements ResourceResolver<MediaFileAvailableInput, MediaFileAvailableResult>
{
  readonly type = 'media-file-available'
  private readonly mediaStatusManager = new MediaStatusManager()

  constructor(private readonly options: MediaResolverOptions) {}

  getKey(input: MediaFileAvailableInput): string {
    return input.mediaId
  }

  async isSatisfied(
    ctx: ResolveCheckContext<MediaFileAvailableInput>,
  ): Promise<MediaFileAvailableResult | null> {
    const mediaItem = this.options.getMediaItem(ctx.input.mediaId)
    if (!mediaItem || mediaItem.source.type !== 'user-selected') return null

    if (DataSourceHelpers.isProjectLoad(mediaItem.source)) {
      return null
    }

    if (!mediaItem.source.selectedFile && mediaItem.source.progress === 100) {
      return null
    }

    return null
  }

  async resolve(ctx: ResolveContext<MediaFileAvailableInput>): Promise<MediaFileAvailableResult> {
    const mediaItem = this.options.getMediaItem(ctx.input.mediaId)
    if (!mediaItem) {
      throw new Error(`找不到媒体项目: ${ctx.input.mediaId}`)
    }

    if (mediaItem.source.type !== 'user-selected') {
      throw new Error(`media-file-available 暂只支持 user-selected: ${mediaItem.source.type}`)
    }

    const source = mediaItem.source as UserSelectedFileSourceData

    try {
      this.transitionMediaStatus(mediaItem, 'asyncprocessing')
      RuntimeStateActions.startAcquisition(source)

      ctx.update({
        stage: 'file-available',
        progress: 10,
        message: `Preparing media file: ${mediaItem.name}`,
      })

      let file: File
      let mediaType = null as MediaFileAvailableResult['mediaType']

      if (DataSourceHelpers.isUserCreate(source)) {
        if (!source.selectedFile) {
          throw new Error('USER_CREATE 场景下 selectedFile 不能为 null')
        }

        file = source.selectedFile
        const validationResult = validateFile(file)
        if (!validationResult.isValid) {
          throw new Error(validationResult.errorMessage)
        }

        mediaType = validationResult.mediaType
        mediaItem.mediaType = validationResult.mediaType
        source.selectedFile = null

        const saveFileSuccess = await globalMetaFileManager.saveMediaFile(file, mediaItem.id)
        if (!saveFileSuccess) {
          throw new Error('保存媒体文件失败')
        }

        JobLogger.info('MediaReady', 'media-file-available:user-create', {
          ...JobLogger.forNode(ctx.node),
          mediaStatus: mediaItem.mediaStatus,
          mediaType,
        })
      } else {
        file = await globalMetaFileManager.loadMediaFile(mediaItem.id)
        JobLogger.info('MediaReady', 'media-file-available:project-load', {
          ...JobLogger.forNode(ctx.node),
          mediaStatus: mediaItem.mediaStatus,
          mediaType: mediaItem.mediaType,
        })
      }

      RuntimeStateActions.completeAcquisition(source)
      ctx.update({
        stage: 'file-available',
        progress: 100,
        message: `Media file available: ${mediaItem.name}`,
      })

      return { mediaItem, file, mediaType }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : '文件处理失败'
      RuntimeStateActions.setError(source, errorMessage)
      this.transitionMediaStatus(mediaItem, 'error')
      throw error
    }
  }

  private transitionMediaStatus(
    mediaItem: MediaFileAvailableResult['mediaItem'],
    status: 'asyncprocessing' | 'error',
  ): void {
    if (mediaItem.mediaStatus === status) return
    this.mediaStatusManager.transitionTo(mediaItem, status, { resolver: this.type })
  }
}
