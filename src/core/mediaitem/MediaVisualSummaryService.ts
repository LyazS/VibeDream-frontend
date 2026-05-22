import { fetchClient } from '@/utils/fetchClient'
import { useUnifiedStore } from '@/core/unifiedStore'
import type { UnifiedMediaItemData } from './types'
import { BizyairFileUploader } from '@/core/utils/bizyairFileUploader'
import type { FileData } from '@/core/datasource/providers/ai-generation/types'

export interface SummarizeMediaVisualOptions {
  force?: boolean
  onProgress?: (stage: string, progress: number) => void
}

export interface MediaVisualMetadata {
  title: string
  summary: string
}

export interface SummarizeMediaVisualResult {
  success: boolean
  visual?: MediaVisualMetadata
  cached: boolean
  error?: string
}

interface MediaVisualSummaryApiResponse {
  success: boolean
  visual?: MediaVisualMetadata
  error?: string
}

type VisualMediaItem = UnifiedMediaItemData & {
  mediaType: 'video' | 'image'
}

function isVisualMediaItem(mediaItem: UnifiedMediaItemData): mediaItem is VisualMediaItem {
  return mediaItem.mediaType === 'video' || mediaItem.mediaType === 'image'
}

export class MediaVisualSummaryService {
  async summarizeMediaVisual(
    mediaItem: UnifiedMediaItemData,
    options: SummarizeMediaVisualOptions = {},
  ): Promise<SummarizeMediaVisualResult> {
    const existingTitle = mediaItem.metadata?.visual?.title?.trim()
    const existingSummary = mediaItem.metadata?.visual?.summary?.trim()
    if (existingTitle && existingSummary && !options.force) {
      return {
        success: true,
        visual: {
          title: existingTitle,
          summary: existingSummary,
        },
        cached: true,
      }
    }

    if (!isVisualMediaItem(mediaItem)) {
      return {
        success: false,
        cached: false,
        error: '只支持视频和图片素材生成视觉摘要',
      }
    }

    const unifiedStore = useUnifiedStore()

    try {
      options.onProgress?.('准备素材', 5)
      const readyMediaItem = await this.ensureMediaReady(mediaItem)
      const exportSize = this.buildSummaryExportSize(readyMediaItem)

      options.onProgress?.('导出并上传素材', 15)
      const uploadResult = await BizyairFileUploader.uploadFile(
        this.buildFileData(readyMediaItem),
        unifiedStore.getMediaItem,
        unifiedStore.getTimelineItem,
        (stage, progress) => {
          const mappedProgress = 15 + Math.round(progress * 0.7)
          options.onProgress?.(`${stage}`, mappedProgress)
        },
        exportSize,
      )

      if (!uploadResult.success || !uploadResult.url) {
        throw new Error(uploadResult.error || '素材上传失败')
      }

      options.onProgress?.('生成视觉摘要', 90)
      const visual = await this.requestVisualSummary(uploadResult.url, readyMediaItem.mediaType)

      unifiedStore.updateMediaItemMetadata(readyMediaItem.id, {
        visual: {
          ...readyMediaItem.metadata?.visual,
          title: visual.title,
          summary: visual.summary,
        },
      })

      options.onProgress?.('完成', 100)
      return {
        success: true,
        visual,
        cached: false,
      }
    } catch (error) {
      return {
        success: false,
        cached: false,
        error: error instanceof Error ? error.message : '生成视觉摘要失败',
      }
    }
  }

  private async ensureMediaReady(mediaItem: UnifiedMediaItemData): Promise<VisualMediaItem> {
    const unifiedStore = useUnifiedStore()

    if (mediaItem.mediaStatus === 'pending') {
      // TODO(Resource DAG): 视觉摘要的媒体 ready 等待点仍在旧启动入口上。
      // 后续应直接 await unifiedStore.ensureMediaReady(mediaItem.id)。
      throw new Error(
        '[Resource DAG TODO] 视觉摘要媒体 ready 等待点需要迁移，禁止继续调用 startMediaProcessing',
      )
    }

    if (mediaItem.mediaStatus !== 'ready') {
      await unifiedStore.waitForMediaItemReady(mediaItem.id)
    }

    const latestMediaItem = unifiedStore.getMediaItem(mediaItem.id)
    if (!latestMediaItem) {
      throw new Error(`找不到媒体项目: ${mediaItem.id}`)
    }

    if (!isVisualMediaItem(latestMediaItem)) {
      throw new Error('只支持视频和图片素材生成视觉摘要')
    }

    return latestMediaItem
  }

  private buildFileData(mediaItem: UnifiedMediaItemData): FileData {
    return {
      name: mediaItem.name,
      mediaItemId: mediaItem.id,
      source: 'media-item',
      mediaType: mediaItem.mediaType as 'video' | 'image',
      __type__: 'FileData',
    }
  }

  private buildSummaryExportSize(mediaItem: VisualMediaItem): {
    outputWidth: number
    outputHeight: number
  } {
    const dimensions = this.getMediaDimensions(mediaItem)
    if (!dimensions) {
      return {
        outputWidth: 480,
        outputHeight: 480,
      }
    }

    const maxSide = Math.max(dimensions.width, dimensions.height)
    if (maxSide <= 480) {
      return {
        outputWidth: dimensions.width,
        outputHeight: dimensions.height,
      }
    }

    const scale = 480 / maxSide
    return {
      outputWidth: Math.max(1, Math.round(dimensions.width * scale)),
      outputHeight: Math.max(1, Math.round(dimensions.height * scale)),
    }
  }

  private getMediaDimensions(mediaItem: VisualMediaItem): { width: number; height: number } | null {
    const originalWidth = mediaItem.runtime.bunny?.originalWidth
    const originalHeight = mediaItem.runtime.bunny?.originalHeight
    if (originalWidth && originalHeight) {
      return {
        width: originalWidth,
        height: originalHeight,
      }
    }

    const bunnyMedia = mediaItem.runtime.bunny?.bunnyMedia
    if (bunnyMedia?.width && bunnyMedia?.height) {
      return {
        width: bunnyMedia.width,
        height: bunnyMedia.height,
      }
    }

    const imageClip = mediaItem.runtime.bunny?.imageClip
    if (imageClip?.width && imageClip?.height) {
      return {
        width: imageClip.width,
        height: imageClip.height,
      }
    }

    return null
  }

  private async requestVisualSummary(
    url: string,
    mediaType: 'video' | 'image',
  ): Promise<MediaVisualMetadata> {
    const response = await fetchClient.post<MediaVisualSummaryApiResponse>(
      '/api/media/visual-summary',
      {
        url,
        media_type: mediaType,
      },
    )

    const visual = response.data.visual
    if (!response.data.success || !visual?.title?.trim() || !visual.summary?.trim()) {
      throw new Error(response.data.error || '视觉摘要生成失败')
    }

    return {
      title: visual.title.trim(),
      summary: visual.summary.trim(),
    }
  }
}

export const mediaVisualSummaryService = new MediaVisualSummaryService()
