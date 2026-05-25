/**
 * BizyAir 处理器
 *
 * 负责管理 BizyAir 媒体生成任务，包括任务提交、进度监控、结果获取等
 * 前端直接调用 BizyAir API，不经过后端
 */

import {
  DataSourceProcessor,
  type AcquisitionTask,
  type PreparedMediaFile,
} from '@/core/datasource/core/BaseDataSourceProcessor'
import { RuntimeStateActions } from '@/core/datasource/core/BaseDataSource'
import { globalMetaFileManager } from '@/core/managers/media/globalMetaFileManager'
import { DATA_SOURCE_CONCURRENCY } from '@/constants/ConcurrencyConstants'
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

// ==================== BizyAir 处理器 ====================

/**
 * BizyAir 处理器 - 管理 BizyAir 媒体生成任务
 */
export class BizyAirProcessor extends DataSourceProcessor {
  private static instance: BizyAirProcessor

  // 存储 AbortController 用于取消任务
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
    // BizyAir 需要限制并发数
    this.maxConcurrentTasks = DATA_SOURCE_CONCURRENCY.AI_GENERATION_MAX_CONCURRENT_TASKS

    // 初始化 BizyAir 配置管理器
    BizyAirConfigManager.initialize()
      .then(() => {
        console.log('✅ [BizyAirProcessor] BizyAir 配置管理器已初始化')
      })
      .catch((error) => {
        console.error('❌ [BizyAirProcessor] BizyAir 配置管理器初始化失败:', error)
      })
  }

  // ==================== 实现抽象方法 ====================

  /**
   * 执行具体的获取任务。
   *
   * @deprecated 仅保留给旧 Processor 队列主链。BizyAir 新链路优先通过
   * AIGeneratedMediaResolver 和 DAG 拆分接口推进。
   */
  protected async executeTask(task: AcquisitionTask): Promise<void> {
    const mediaItem = task.mediaItem

    console.log(`🎬 [BizyAirProcessor] 开始执行任务: ${task.id} - ${mediaItem.name}`)

    // executeTask 内部调用 processMediaItem
    await this.processMediaItem(mediaItem)

    // 检查执行结果 - 通过检查错误信息来判断状态
    const source = mediaItem.source
    if (!BizyAirTypeGuards.isBizyAirSource(source)) {
      throw new Error('数据源类型错误，期望 BizyAirSourceData')
    }
    const bizyAirSource = source as BizyAirSourceData
    if (bizyAirSource.errorMessage) {
      throw new Error(bizyAirSource.errorMessage)
    }

    console.log(`✅ [BizyAirProcessor] 任务执行成功: ${task.id}`)
  }

  /**
   * 获取处理器类型
   */
  getProcessorType(): string {
    return 'bizyair'
  }

  // ==================== BizyAir 特定行为方法 ====================

  /**
   * 轮询 BizyAir 任务（只轮询，不提交）
   *
   * 注意：提交任务应该在 UI 层处理
   *
   * @param source - BizyAir 数据源
   * @param mediaItem - 媒体项目
   * @param signal - AbortSignal 用于取消任务
   * @returns 生成的文件对象
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
      throw new Error('BizyAir 任务ID不存在，任务应该在UI层提交')
    }

    console.log(`🔄 [BizyAirProcessor] 轮询任务: ${requestId}`)

    this.transitionMediaStatus(mediaItem, 'asyncprocessing')
    // 1. 轮询任务直到完成
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

    // 2. 更新任务状态
    source.taskStatus = taskDetail.status
    console.log(`📋 [BizyAirProcessor] 任务状态: ${taskDetail.status}`)

    // 3. 检查任务是否失败或取消
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

    // 7. 发送系统通知（复用前面获取的 unifiedStore）
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
   * 为媒体项目准备文件
   *
   * 支持三种场景：
   * - 场景A：任务已完成并下载到本地 -> 从 media/{id} 加载
   * - 场景B：本地文件不存在但有 resultData -> 直接从 resultData 获取结果（无需轮询）
   * - 场景C：有 bizyairTaskId，任务进行中 -> pollBizyAirTask
   *
   * 注意：场景D（提交新任务）已移至 UI 层处理
   *
   * @param mediaItem 媒体项目
   * @returns 文件准备结果
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

      // 场景判断：优先尝试从本地恢复
      const localFileExists = await globalMetaFileManager.verifyMediaFileExists(mediaItem.id)

      if (localFileExists) {
        // 场景 A: 从本地加载已完成的文件
        this.transitionMediaStatus(mediaItem, 'asyncprocessing')
        console.log(`📂 [场景A] 从项目加载已完成的 BizyAir 文件: ${mediaItem.id}`)
        file = await globalMetaFileManager.loadMediaFile(mediaItem.id)
        needSaveMeta = false // meta 文件已存在
        needSaveMedia = false // 媒体文件已存在
      } else if (
        bizyAirSource.resultData &&
        bizyAirSource.taskStatus === BizyAirTaskStatus.SUCCESS
      ) {
        // 场景 B: 远程任务已完成，重新获取文件
        this.transitionMediaStatus(mediaItem, 'asyncprocessing')
        console.log(`🎯 [场景B] 远程任务已完成，直接从 resultData 获取:`, bizyAirSource.resultData)
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
        // 场景 C & D: 执行或恢复 BizyAir 任务
        console.log(`🔄 [场景C/D] 执行 BizyAir 任务: ${bizyAirSource.bizyairTaskId || '新任务'}`)

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

  // ==================== 实现统一媒体项目处理 ====================

  /**
   * 处理完整的媒体项目生命周期
   *
   * @deprecated 兼容旧 Processor 主链的聚合入口。当前 DAG 仍复用其内部共享逻辑，
   * 但新业务入口不应再直接依赖该方法。
   *
   * @param mediaItem 媒体项目
   */
  async processMediaItem(mediaItem: UnifiedMediaItemData): Promise<void> {
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

  // ==================== 任务取消功能 ====================

  /**
   * 取消任务
   *
   * 只能取消 pending 状态的任务
   *
   * @param taskId 任务 ID
   * @returns 是否成功取消
   */
  async cancelTask(taskId: string): Promise<boolean> {
    const task = this.tasks.get(taskId)
    if (!task) {
      console.warn(`⚠️ [BizyAirProcessor] 任务不存在: ${taskId}`)
      return false
    }

    // 检查状态是否为 pending
    if (task.mediaItem.mediaStatus !== 'pending') {
      console.warn(
        `⚠️ [BizyAirProcessor] 只能取消 pending 状态的任务，当前状态: ${task.mediaItem.mediaStatus}`,
      )
      return false
    }

    const source = task.mediaItem.source
    if (!BizyAirTypeGuards.isBizyAirSource(source)) {
      console.warn(`⚠️ [BizyAirProcessor] 数据源类型错误`)
      return false
    }

    const bizyAirSource = source as BizyAirSourceData
    const bizyairTaskId = bizyAirSource.bizyairTaskId

    // 从统一Store获取 API Key
    const unifiedStore = useUnifiedStore()
    const apiKey = await unifiedStore.getBizyAirApiKey()

    try {
      // 1. 先调用 BizyAir API 取消远程任务
      if (bizyairTaskId && apiKey) {
        const cancelSuccess = await BizyAirAPIClient.cancelTask(bizyairTaskId, apiKey)
        if (!cancelSuccess) {
          console.warn(
            `⚠️ [BizyAirProcessor] BizyAir 任务取消失败，不更新本地状态: ${bizyairTaskId}`,
          )
          return false
        }
      }

      // 2. 中断轮询连接（如果存在）
      const abortController = this.abortControllers.get(taskId)
      if (abortController) {
        console.log(`🛑 [BizyAirProcessor] 中断任务执行: ${taskId}`)
        abortController.abort()
        // 立即清理 AbortController，避免依赖异步 finally
        this.abortControllers.delete(taskId)
      }

      // 3. 设置为 cancelled 状态
      this.transitionMediaStatus(task.mediaItem, 'cancelled')
      bizyAirSource.taskStatus = BizyAirTaskStatus.CANCELED
      bizyAirSource.errorMessage = '任务已取消'

      // 4. 保存 cancelled 状态到 meta 文件
      await globalMetaFileManager.saveMetaFile(task.mediaItem)
      console.log(`💾 [BizyAirProcessor] 已保存 cancelled 状态到 meta: ${task.mediaItem.name}`)

      console.log(`✅ [BizyAirProcessor] 任务取消成功: ${bizyairTaskId || taskId}`)
      return true
    } catch (error) {
      console.error(`❌ [BizyAirProcessor] 取消任务失败: ${bizyairTaskId || taskId}`, error)
      return false
    }
  }
}
