/**
 * 用户选择文件 datasource 执行器。
 *
 * 负责本地文件校验、文件获取、解码和项目内持久化。
 */

import {
  DataSourceProcessor,
  type PreparedMediaFile,
} from '@/core/datasource/core/BaseDataSourceProcessor'
import type { UserSelectedFileSourceData } from '@/core/datasource/providers/user-selected/UserSelectedFileSource'
import {
  SUPPORTED_MEDIA_TYPES,
  FILE_SIZE_LIMITS,
  detectFileMediaType,
  validateFile,
  type FileValidationResult,
} from '@/core/utils/mediaTypeDetector'
import { RuntimeStateActions } from '@/core/datasource/core/BaseDataSource'
import { DataSourceHelpers } from '@/core/datasource/core/DataSourceHelpers'
import { globalMetaFileManager } from '@/core/managers/media/globalMetaFileManager'
import type { UnifiedMediaItemData, MediaStatus, MediaType } from '@/core/mediaitem/types'
import { UnifiedMediaItemActions } from '@/core/mediaitem/actions'
import { sleep } from '@/utils/fetchClient'

// ==================== 用户选择文件 datasource 执行器 ====================

/**
 * 用户选择文件执行器。
 */
export class UserSelectedFileProcessor extends DataSourceProcessor {
  private static instance: UserSelectedFileProcessor

  /**
   * 获取单例实例
   */
  static getInstance(): UserSelectedFileProcessor {
    if (!this.instance) {
      this.instance = new UserSelectedFileProcessor()
    }
    return this.instance
  }

  private constructor() {
    super()
  }

  // ==================== 用户选择文件执行逻辑 ====================

  /**
   * 获取执行器类型
   */
  getProcessorType(): string {
    return 'user-selected'
  }

  async processTaskDirectly(mediaItem: UnifiedMediaItemData): Promise<void> {
    try {
      console.log(`🚀 [UserSelectedFileProcessor] 开始处理媒体项目: ${mediaItem.name}`)

      const preparedFile = await this.prepareMediaFileForDag(mediaItem)
      await this.decodePreparedMediaFileForDag(mediaItem, preparedFile)

      console.log(`✅ [UserSelectedFileProcessor] 媒体项目处理完成: ${mediaItem.name}`)
    } catch (error) {
      console.error(`❌ [UserSelectedFileProcessor] 媒体项目处理失败: ${mediaItem.name}`, error)
      this.transitionMediaStatus(mediaItem, 'error')
      mediaItem.source.errorMessage = error instanceof Error ? error.message : '处理失败'
    }
  }

  /**
   * 为 `media-file-available` 阶段准备文件。
   */
  async prepareMediaFileForDag(mediaItem: UnifiedMediaItemData): Promise<PreparedMediaFile> {
    const source = mediaItem.source as UserSelectedFileSourceData

    try {
      this.transitionMediaStatus(mediaItem, 'asyncprocessing')

      RuntimeStateActions.startAcquisition(source)

      let file: File
      let mediaType: MediaType | null = null

      // 🌟 使用辅助函数判断场景
      if (DataSourceHelpers.isUserCreate(source)) {
        // 用户创建：使用选择的文件并验证
        if (!source.selectedFile) {
          throw new Error('USER_CREATE 场景下 selectedFile 不能为 null')
        }

        file = source.selectedFile
        console.log(`📁 [USER_CREATE] 使用用户选择的文件: ${file.name}`)

        // ✅ 使用完毕后立即清除引用
        source.selectedFile = null
        console.log(`🧹 [USER_CREATE] 已清除 selectedFile 引用`)

        const validationResult = validateFile(file)
        if (!validationResult.isValid) {
          throw new Error(validationResult.errorMessage)
        }
        mediaType = validationResult.mediaType
      } else {
        // 项目加载：从项目目录加载文件
        file = await globalMetaFileManager.loadMediaFile(mediaItem.id)
        console.log(`📂 [PROJECT_LOAD] 从项目加载文件: ${mediaItem.id}`)
        // mediaType 保持为 null，外部无需设置
      }

      await RuntimeStateActions.completeAcquisition(source)
      return { file, mediaType }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : '文件处理失败'
      RuntimeStateActions.setError(source, errorMessage)
      this.transitionMediaStatus(mediaItem, 'error')
      throw error
    }
  }

  async decodePreparedMediaFileForDag(
    mediaItem: UnifiedMediaItemData,
    preparedFile: PreparedMediaFile,
  ): Promise<void> {
    const source = mediaItem.source as UserSelectedFileSourceData

    try {
      const { file, mediaType } = preparedFile
      if (mediaType !== null) {
        mediaItem.mediaType = mediaType
      }

      this.transitionMediaStatus(mediaItem, 'decoding')

      const bunnyResult = await this.bunnyProcessor.processMedia(mediaItem, file)

      mediaItem.runtime.bunny = bunnyResult.bunnyObjects
      mediaItem.duration = Number(bunnyResult.durationN)
      console.log(`🔧 [UserSelectedFileProcessor] 元数据设置完成: ${mediaItem.name}`)

      if (DataSourceHelpers.isUserCreate(source)) {
        try {
          const saveResult = await globalMetaFileManager.saveMediaToProject(mediaItem, file)
          if (saveResult.success) {
            console.log(`💾 [USER_CREATE] 媒体和Meta文件保存成功: ${mediaItem.name}`)
          } else {
            throw new Error(saveResult.error || '保存失败')
          }
        } catch (saveError) {
          console.error(`❌ 媒体文件保存失败: ${mediaItem.name}`, saveError)
          console.warn(`媒体文件保存失败，但解析继续: ${mediaItem.name}`, saveError)
        }
      } else {
        console.log(`⏭️ [PROJECT_LOAD] 跳过文件保存: ${mediaItem.name}`)
      }

    } catch (error) {
      console.error(`❌ [UserSelectedFileProcessor] 媒体项目解码失败: ${mediaItem.name}`, error)
      this.transitionMediaStatus(mediaItem, 'error')
      mediaItem.source.errorMessage = error instanceof Error ? error.message : '处理失败'
      throw error
    }
  }
}
