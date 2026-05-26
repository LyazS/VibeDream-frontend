/**
 * BizyAir datasource 执行器。
 *
 * 负责恢复 BizyAir 远程结果、下载媒体文件、解码并写回本地媒体状态。
 * 前端直接调用 BizyAir API，不经过后端代理。
 */

import {
  DataSourceProcessor,
  type PreparedMediaFile,
} from '@/core/datasource/core/BaseDataSourceProcessor'
import { RuntimeStateActions } from '@/core/datasource/core/BaseDataSource'
import { globalMetaFileManager } from '@/core/managers/media/globalMetaFileManager'
import type { UnifiedMediaItemData, MediaType } from '@/core/mediaitem/types'
import type { BizyAirSourceData } from './BizyAirSource'
import { BizyAirTypeGuards } from './BizyAirSource'
import { BizyAirAPIClient } from './BizyAirAPIClient'
import { BizyAirConfigManager } from './BizyAirConfigManager'
import { BizyAirTaskStatus } from './types'
import { mapBizyAirContentTypeToMediaType } from './BizyAirSource'
import { DataSourceHelpers } from '@/core/datasource/core/DataSourceHelpers'
import { useUnifiedStore } from '@/core/unifiedStore'

/**
 * 从 URL 推断文件扩展名
 */
function getExtensionFromUrl(url: string): string {
  const urlPath = new URL(url).pathname
  const extensionMatch = urlPath.match(/\.([^.]+)$/)
  if (extensionMatch) {
    return extensionMatch[1]
  }

  // 默认扩展名
  return 'bin'
}

// ==================== BizyAir datasource 执行器 ====================

/**
 * BizyAir 执行器。
 */
export class BizyAirProcessor extends DataSourceProcessor {
  private static instance: BizyAirProcessor

  // 以 mediaId 为 key 维护远程轮询中断控制。
  private abortControllers: Map<string, AbortController> = new Map()
  private dagPrepareState = new Map<
    string,
    { needSaveMeta: boolean; needSaveMedia: boolean }
  >()

  /**
   * 获取单例实例
   */
  static getInstance(): BizyAirProcessor {
    if (!this.instance) {
      this.instance = new BizyAirProcessor()
    }
    return this.instance
  }

  /**
   * 私有构造函数，确保单例模式
   */
  private constructor() {
    super()
    // 初始化 BizyAir 配置管理器
    BizyAirConfigManager.initialize()
      .then(() => {
        console.log('✅ [BizyAirProcessor] BizyAir 配置管理器已初始化')
      })
      .catch((error) => {
        console.error('❌ [BizyAirProcessor] BizyAir 配置管理器初始化失败:', error)
      })
  }

  /**
   * 获取执行器类型
   */
  getProcessorType(): string {
    return 'bizyair'
  }

  // ==================== BizyAir 执行逻辑 ====================

  /**
   * 轮询 BizyAir 远程任务直到产出可下载文件。
   */
  private async pollBizyAirTask(
    source: BizyAirSourceData,
    mediaItem: UnifiedMediaItemData,
    signal: AbortSignal,
  ): Promise<File> {
    // 从统一Store获取 API Key
    const unifiedStore = useUnifiedStore()
    const apiKey = await unifiedStore.getBizyAirApiKey()

    if (!apiKey) {
      throw new Error('API Key 未设置，请在设置中配置 BizyAir API Key')
    }

    const requestId = source.bizyairTaskId
    if (!requestId) {
      throw new Error('BizyAir 远程任务 ID 不存在，无法恢复执行')
    }

    console.log(`🔄 [BizyAirProcessor] 轮询任务: ${requestId}`)

    this.transitionMediaStatus(mediaItem, 'asyncprocessing')
    // 1. 轮询远程状态直到完成
    const taskDetail = await BizyAirAPIClient.pollUntilComplete(
      requestId,
      apiKey,
      (progress, message) => {
        // 更新进度
        source.progress = progress
        console.log(`📊 [BizyAirProcessor] 任务进度: ${progress}% - ${message}`)
      },
      signal,
    )

    // 2. 同步 datasource 中的远程状态
    source.taskStatus = taskDetail.status
    console.log(`📋 [BizyAirProcessor] 任务状态: ${taskDetail.status}`)

    // 3. 远程阶段失败或取消时直接终止本地执行
    if (taskDetail.status === BizyAirTaskStatus.FAILED) {
      const errorMessage = taskDetail.error?.message || '任务失败'
      throw new Error(errorMessage)
    }

    if (taskDetail.status === BizyAirTaskStatus.CANCELED) {
      throw new Error('任务已取消')
    }

    // 4. 获取结果 URL
    const result = await BizyAirAPIClient.getTaskResults(requestId, apiKey, signal)
    console.log(`✅ [BizyAirProcessor] 获取到结果 URL: ${result.url}`)

    // 5. 下载文件
    const file = await this.downloadFile(result.url, requestId, source)

    // 6. 保存结果数据
    source.resultData = {
      url: result.url,
      bizyair_task_id: requestId,
    }

    // 7. 发送系统通知
    await unifiedStore.notifySystem('BizyAir 生成完成', '您的媒体文件已成功生成')

    return file
  }

  /**
   * 下载文件
   *
   * @param url - 文件 URL
   * @param taskId - 任务 ID
   * @param source - BizyAir 数据源
   * @returns 文件对象
   */
  private async downloadFile(
    url: string,
    taskId: string,
    source: BizyAirSourceData,
  ): Promise<File> {
    try {
      const response = await fetch(url)
      if (!response.ok) {
        throw new Error(`下载失败: ${response.statusText}`)
      }

      const blob = await response.blob()
      const extension = getExtensionFromUrl(url)
      const mimeType = blob.type || `application/${extension}`

      const file = new File([blob], `bizyair_${taskId}.${extension}`, {
        type: mimeType,
      })

      await RuntimeStateActions.completeAcquisition(source)
      console.log(
        `✅ [BizyAirProcessor] 文件下载成功: ${url}, MIME: ${mimeType}, 扩展名: ${extension}`,
      )

      return file
    } catch (error) {
      throw new Error(`下载文件失败: ${error instanceof Error ? error.message : '未知错误'}`)
    }
  }

  /**
   * 为 BizyAir 生成媒体准备本地文件。
   *
   * 当前覆盖三种恢复/执行场景：
   * - 本地文件已存在，直接加载
   * - 远程结果已完成，直接按 `resultData` 下载
   * - 远程任务仍在进行中，继续轮询
   */
  private async prepareFileForMediaItem(mediaItem: UnifiedMediaItemData): Promise<{
    success: boolean
    file?: File
    mediaType?: MediaType | null
    needSaveMeta: boolean
    needSaveMedia: boolean
    error?: string
  }> {
    const source = mediaItem.source
    if (!BizyAirTypeGuards.isBizyAirSource(source)) {
      return {
        success: false,
        error: '数据源类型错误，期望 BizyAirSourceData',
        needSaveMeta: false,
        needSaveMedia: false,
      }
    }

    const bizyAirSource = source as BizyAirSourceData

    try {
      let file: File
      let mediaType: MediaType | null = null
      let needSaveMeta: boolean
      let needSaveMedia: boolean

      // 创建 AbortController
      const abortController = new AbortController()
      this.abortControllers.set(mediaItem.id, abortController)

      // 优先尝试从本地恢复，再决定是否回到远程阶段。
      const localFileExists = await globalMetaFileManager.verifyMediaFileExists(mediaItem.id)

      if (localFileExists) {
        // 本地文件已存在，直接恢复。
        this.transitionMediaStatus(mediaItem, 'asyncprocessing')
        console.log(`📂 [BizyAirProcessor] 从项目加载已完成的 BizyAir 文件: ${mediaItem.id}`)
        file = await globalMetaFileManager.loadMediaFile(mediaItem.id)
        needSaveMeta = false // meta 文件已存在
        needSaveMedia = false // 媒体文件已存在
      } else if (
        bizyAirSource.resultData &&
        bizyAirSource.taskStatus === BizyAirTaskStatus.SUCCESS
      ) {
        // 远程阶段已完成，但本地文件缺失，重新下载产物。
        this.transitionMediaStatus(mediaItem, 'asyncprocessing')
        console.log(`🎯 [BizyAirProcessor] 远程任务已完成，直接从 resultData 获取:`, bizyAirSource.resultData)
        RuntimeStateActions.startAcquisition(bizyAirSource)

        file = await this.downloadFile(
          bizyAirSource.resultData.url,
          bizyAirSource.bizyairTaskId,
          bizyAirSource,
        )
        mediaType = mapBizyAirContentTypeToMediaType(bizyAirSource.requestParams.content_type)

        await RuntimeStateActions.completeAcquisition(bizyAirSource)
        needSaveMeta = true // 需要更新 meta 文件
        needSaveMedia = true // 需要保存新获取的媒体文件
      } else {
        // 远程阶段仍在运行，继续轮询。
        console.log(`🔄 [BizyAirProcessor] 恢复 BizyAir 任务: ${bizyAirSource.bizyairTaskId}`)

        if (bizyAirSource.taskStatus === BizyAirTaskStatus.FAILED) {
          throw new Error('BizyAir 任务已失败，无法继续')
        }

        if (bizyAirSource.taskStatus === BizyAirTaskStatus.CANCELED) {
          throw new Error('BizyAir 任务已取消，无法继续')
        }

        RuntimeStateActions.startAcquisition(bizyAirSource)

        file = await this.pollBizyAirTask(bizyAirSource, mediaItem, abortController.signal)
        mediaType = mapBizyAirContentTypeToMediaType(bizyAirSource.requestParams.content_type)

        await RuntimeStateActions.completeAcquisition(bizyAirSource)
        needSaveMeta = true // 需要保存 meta 文件
        needSaveMedia = true // 需要保存新生成的媒体文件
      }

      // 清理 AbortController
      this.abortControllers.delete(mediaItem.id)

      return { success: true, file, mediaType, needSaveMeta, needSaveMedia }
    } catch (error) {
      // 清理 AbortController
      this.abortControllers.delete(mediaItem.id)

      const errorMessage = error instanceof Error ? error.message : 'BizyAir 生成失败'
      RuntimeStateActions.setError(bizyAirSource, errorMessage)

      // 失败时也要保存 meta，以持久化失败状态
      return {
        success: false,
        error: errorMessage,
        needSaveMeta: true, // 失败也要保存 meta，记录 FAILED 状态
        needSaveMedia: false, // 失败时不保存媒体
      }
    }
  }

  async processTaskDirectly(mediaItem: UnifiedMediaItemData): Promise<void> {
    const source = mediaItem.source
    if (!BizyAirTypeGuards.isBizyAirSource(source)) {
      throw new Error('数据源类型错误，期望 BizyAirSourceData')
    }

    const bizyAirSource = source as BizyAirSourceData

    try {
      console.log(`🚀 [BizyAirProcessor] 开始处理媒体项目: ${mediaItem.name}`)

      // 1. 状态转换
      if (mediaItem.mediaStatus === 'missing') {
        console.log(`🔄 [BizyAirProcessor] 媒体文件缺失，先转换到 pending: ${mediaItem.name}`)
        this.transitionMediaStatus(mediaItem, 'pending')
      } else if (mediaItem.mediaStatus === 'cancelled') return
      else if (mediaItem.mediaStatus === 'error') return

      // 2. USER_CREATE 预保存 meta 文件
      if (DataSourceHelpers.isUserCreate(mediaItem.source)) {
        console.log(`📝 [USER_CREATE] 预保存Meta文件: ${mediaItem.name}`)
        const saveMetaSuccess = await globalMetaFileManager.saveMetaFile(mediaItem)
        if (saveMetaSuccess) {
          console.log(`✅ [USER_CREATE] Meta文件预保存成功: ${mediaItem.name}`)
        } else {
          console.warn(`⚠️ [USER_CREATE] Meta文件预保存失败: ${mediaItem.name}`)
        }
      } else {
        console.log(`⏭️ [PROJECT_LOAD] 跳过Meta文件预保存: ${mediaItem.name}`)
      }

      // 3. 执行文件准备
      const prepareResult = await this.prepareFileForMediaItem(mediaItem)

      // 4. 处理失败情况
      if (!prepareResult.success) {
        this.transitionMediaStatus(mediaItem, 'error')
        bizyAirSource.errorMessage = prepareResult.error

        // 失败时保存 meta 文件（持久化 FAILED 状态）
        if (prepareResult.needSaveMeta) {
          console.log(`💾 [失败处理] 保存失败状态的Meta文件: ${mediaItem.name}`)
          await globalMetaFileManager.saveMetaFile(mediaItem)
        }

        return
      }

      // 5. 成功情况：继续处理
      const { file, mediaType, needSaveMeta, needSaveMedia } = prepareResult

      if (mediaType) {
        mediaItem.mediaType = mediaType
      }

      // 6. 解析处理
      this.transitionMediaStatus(mediaItem, 'decoding')
      const bunnyResult = await this.bunnyProcessor.processMedia(mediaItem, file!)

      // 7. 直接设置元数据
      mediaItem.runtime.bunny = bunnyResult.bunnyObjects
      mediaItem.duration = Number(bunnyResult.durationN)
      console.log(`🔧 [BizyAirProcessor] 元数据设置完成: ${mediaItem.name}`)

      // 8. 根据标志决定保存策略（分别调用 saveMediaFile 和 saveMetaFile）
      if (needSaveMedia) {
        console.log(`💾 [保存媒体] 保存媒体文件: ${mediaItem.name}`)
        const saveMediaSuccess = await globalMetaFileManager.saveMediaFile(file!, mediaItem.id)
        if (!saveMediaSuccess) {
          throw new Error('保存媒体文件失败')
        }
      }

      if (needSaveMeta) {
        console.log(`💾 [保存Meta] 保存Meta文件: ${mediaItem.name}`)
        const saveMetaSuccess = await globalMetaFileManager.saveMetaFile(mediaItem)
        if (!saveMetaSuccess) {
          console.warn(`⚠️ Meta文件保存失败，但媒体文件已保存: ${mediaItem.name}`)
        }
      }

      if (!needSaveMedia && !needSaveMeta) {
        console.log(`⏭️ [跳过保存] 文件已存在: ${mediaItem.name}`)
      }

      // 9. 设置为就绪状态
      this.transitionMediaStatus(mediaItem, 'ready')
      console.log(`✅ [BizyAirProcessor] 媒体项目处理完成: ${mediaItem.name}`)
    } catch (error) {
      // 清理 AbortController
      this.abortControllers.delete(mediaItem.id)

      console.error(`❌ [BizyAirProcessor] 媒体项目处理失败: ${mediaItem.name}`, error)
      this.transitionMediaStatus(mediaItem, 'error')
      bizyAirSource.errorMessage = error instanceof Error ? error.message : '处理失败'

      // 保存失败状态的 meta 文件
      console.log(`💾 [异常处理] 保存失败状态的Meta文件: ${mediaItem.name}`)
      await globalMetaFileManager.saveMetaFile(mediaItem)
    }
  }

  async prepareMediaFileForDag(mediaItem: UnifiedMediaItemData): Promise<PreparedMediaFile> {
    const prepareResult = await this.prepareFileForMediaItem(mediaItem)

    if (!prepareResult.success || !prepareResult.file) {
      const source = mediaItem.source
      if (BizyAirTypeGuards.isBizyAirSource(source)) {
        source.errorMessage = prepareResult.error || '处理失败'
      }

      this.transitionMediaStatus(mediaItem, 'error')

      if (prepareResult.needSaveMeta) {
        await globalMetaFileManager.saveMetaFile(mediaItem)
      }

      throw new Error(prepareResult.error || '处理失败')
    }

    this.dagPrepareState.set(mediaItem.id, {
      needSaveMeta: prepareResult.needSaveMeta,
      needSaveMedia: prepareResult.needSaveMedia,
    })

    return {
      file: prepareResult.file,
      mediaType: prepareResult.mediaType ?? null,
    }
  }

  async decodePreparedMediaFileForDag(
    mediaItem: UnifiedMediaItemData,
    preparedFile: PreparedMediaFile,
  ): Promise<void> {
    const source = mediaItem.source
    if (!BizyAirTypeGuards.isBizyAirSource(source)) {
      throw new Error('数据源类型错误，期望 BizyAirSourceData')
    }

    const saveState = this.dagPrepareState.get(mediaItem.id) ?? {
      needSaveMeta: false,
      needSaveMedia: false,
    }

    try {
      if (preparedFile.mediaType !== null) {
        mediaItem.mediaType = preparedFile.mediaType
      }

      this.transitionMediaStatus(mediaItem, 'decoding')
      const bunnyResult = await this.bunnyProcessor.processMedia(mediaItem, preparedFile.file)

      mediaItem.runtime.bunny = bunnyResult.bunnyObjects
      mediaItem.duration = Number(bunnyResult.durationN)
      console.log(`🔧 [BizyAirProcessor] DAG 元数据设置完成: ${mediaItem.name}`)

      if (saveState.needSaveMedia) {
        const saveMediaSuccess = await globalMetaFileManager.saveMediaFile(
          preparedFile.file,
          mediaItem.id,
        )
        if (!saveMediaSuccess) {
          throw new Error('保存媒体文件失败')
        }
      }

      if (saveState.needSaveMeta) {
        const saveMetaSuccess = await globalMetaFileManager.saveMetaFile(mediaItem)
        if (!saveMetaSuccess) {
          console.warn(`⚠️ Meta文件保存失败，但媒体文件已保存: ${mediaItem.name}`)
        }
      }

      source.errorMessage = undefined
    } catch (error) {
      console.error(`❌ [BizyAirProcessor] DAG 解码失败: ${mediaItem.name}`, error)
      this.transitionMediaStatus(mediaItem, 'error')
      source.errorMessage = error instanceof Error ? error.message : '处理失败'
      await globalMetaFileManager.saveMetaFile(mediaItem)
      throw error
    } finally {
      this.dagPrepareState.delete(mediaItem.id)
    }
  }

}
