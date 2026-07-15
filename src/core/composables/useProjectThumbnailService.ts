import { ref } from 'vue'
import type { UnifiedMediaItemData } from '@/core/mediaitem'
import type { UnifiedTimelineItemData } from '@/core/timelineitem/model/timelineItem'
import { fileSystemService } from '@/core/managers/filesystem/fileSystemService'
import { generateThumbnailForUnifiedMediaItemBunny } from '@/core/bunnyUtils/thumbGenerator'
import { MediaItemQueries } from '@/core/mediaitem'

/**
 * 项目缩略图服务
 * 负责生成、处理和保存项目缩略图
 */
export function useProjectThumbnailService() {
  const isGenerating = ref(false)

  /**
   * 错误类型定义
   */
  class ThumbnailError extends Error {
    constructor(
      message: string,
      public readonly code:
        | 'NO_SOURCE' // 没有找到可用的源项目
        | 'EXTRACTION_FAILED' // 帧提取失败
        | 'PROCESSING_FAILED' // 图像处理失败
        | 'SAVE_FAILED', // 文件保存失败
    ) {
      super(message)
      this.name = 'ThumbnailError'
    }
  }

  /**
   * 筛选时间轴项目，找到适合作为缩略图源的第一个视频或图像项目
   */
  const findThumbnailSource = (
    timelineItems: UnifiedTimelineItemData[],
    mediaModule: {
      getMediaItem: (id: string | null) => UnifiedMediaItemData | undefined
    },
  ): UnifiedTimelineItemData | null => {
    // 按时间位置排序，取第一个视频或图像项目
    const visualItems = timelineItems
      .filter((item) => {
        const mediaItem = mediaModule.getMediaItem(item.mediaItemId)
        return (
          mediaItem &&
          (MediaItemQueries.isVideo(mediaItem) || MediaItemQueries.isImage(mediaItem))
        )
      })
      .sort((a, b) => a.timeRange.timelineStartTime - b.timeRange.timelineStartTime)

    return visualItems.length > 0 ? visualItems[0] : null
  }

  /**
   * 保存缩略图文件到指定目录
   */
  const saveThumbnail = async (projectId: string, imageBlob: Blob): Promise<string> => {
    try {
      // 检查工作空间权限
      const permissionResult = await fileSystemService.checkPermission()
      if (!permissionResult.hasAccess) {
        throw new ThumbnailError('未设置工作目录', 'SAVE_FAILED')
      }

      // 确保缩略图目录存在
      const thumbnailDirPath = fileSystemService.paths.getThumbnailDirPath(projectId)
      const thumbnailDirExists = await fileSystemService.directoryExists(thumbnailDirPath)
      if (!thumbnailDirExists) {
        await fileSystemService.createDirectory(thumbnailDirPath)
      }

      // 保存缩略图文件
      const thumbnailPath = fileSystemService.paths.getThumbnailPath(projectId)
      await fileSystemService.writeFile(thumbnailPath, imageBlob)

      return 'thumbnails/projectThumbnail.webp'
    } catch (error) {
      console.error('保存缩略图失败:', error)
      throw new ThumbnailError('保存缩略图文件失败', 'SAVE_FAILED')
    }
  }

  /**
   * 获取缩略图URL（如果缩略图不存在则返回 undefined）
   */
  const getThumbnailUrl = async (projectId: string): Promise<string | undefined> => {
    try {
      // 检查工作空间权限
      const permissionResult = await fileSystemService.checkPermission()
      if (!permissionResult.hasAccess) {
        return undefined
      }

      // 获取缩略图文件路径
      const thumbnailPath = fileSystemService.paths.getThumbnailPath(projectId)

      // 检查文件是否存在
      const fileExists = await fileSystemService.fileExists(thumbnailPath)
      if (!fileExists) {
        return undefined
      }

      // 读取缩略图文件
      const thumbnailBlob = await fileSystemService.readFileAsBlob(thumbnailPath)

      return URL.createObjectURL(thumbnailBlob)
    } catch (error) {
      // 静默处理错误，返回 undefined
      return undefined
    }
  }

  /**
   * 清理缩略图资源
   */
  const cleanupThumbnails = async (projectId: string): Promise<void> => {
    try {
      // 检查工作空间权限
      const permissionResult = await fileSystemService.checkPermission()
      if (!permissionResult.hasAccess) {
        return
      }

      try {
        // 删除缩略图目录
        const thumbnailDirPath = fileSystemService.paths.getThumbnailDirPath(projectId)
        await fileSystemService.deleteDirectory(thumbnailDirPath, true)
        console.log(`✅ 已清理项目缩略图: ${projectId}`)
      } catch (error) {
        // 缩略图目录可能不存在，忽略错误
        console.log(`📝 缩略图目录不存在，无需清理: ${projectId}`)
      }
    } catch (error) {
      console.warn('清理缩略图失败:', error)
    }
  }

  /**
   * 生成项目缩略图（异步）
   */
  const generateProjectThumbnail = async (
    projectId: string,
    timelineItems: UnifiedTimelineItemData[],
    mediaModule: {
      getMediaItem: (id: string | null) => UnifiedMediaItemData | undefined
    },
  ): Promise<string | null> => {
    if (isGenerating.value) {
      throw new ThumbnailError('缩略图生成中，请稍后重试', 'PROCESSING_FAILED')
    }

    isGenerating.value = true

    try {
      console.log(`🖼️ 开始生成项目缩略图: ${projectId}`)

      // 1. 筛选源项目
      const sourceItem = findThumbnailSource(timelineItems, mediaModule)
      if (!sourceItem) {
        console.log('📝 项目中没有可用的视频或图像素材，跳过缩略图生成')
        return null
      }

      // 2. 获取媒体项目
      const mediaItem = mediaModule.getMediaItem(sourceItem.mediaItemId)
      if (!mediaItem) {
        throw new ThumbnailError('媒体项目不存在', 'NO_SOURCE')
      }

      // 3. 使用统一的缩略图生成函数获取缩略图URL（直接生成640x360的高分辨率缩略图）
      console.log('🔄 使用统一缩略图生成器生成高分辨率缩略图...')
      const thumbnailUrl = await generateThumbnailForUnifiedMediaItemBunny(mediaItem, 0.1, 640, 360)

      if (!thumbnailUrl) {
        throw new ThumbnailError('无法生成缩略图', 'EXTRACTION_FAILED')
      }

      // 4. 将Blob URL转换为Blob对象
      console.log('📥 转换高分辨率缩略图为Blob...')
      const response = await fetch(thumbnailUrl)
      const thumbnailBlob = await response.blob()

      // 清理Blob URL
      URL.revokeObjectURL(thumbnailUrl)

      // 5. 保存文件
      console.log('💾 保存高分辨率缩略图文件...')
      const thumbnailPath = await saveThumbnail(projectId, thumbnailBlob)

      console.log(`✅ 项目缩略图生成成功: ${projectId}`)
      return thumbnailPath
    } catch (error) {
      console.error('❌ 缩略图生成失败:', error)
      throw error
    } finally {
      isGenerating.value = false
    }
  }

  return {
    isGenerating,
    generateProjectThumbnail,
    getThumbnailUrl,
    cleanupThumbnails,
    findThumbnailSource,
    saveThumbnail,
  }
}

export type ProjectThumbnailService = ReturnType<typeof useProjectThumbnailService>
