/**
 * AI生成处理器
 * 负责管理AI媒体生成任务，包括任务提交、进度监控、结果获取等
 */

import {
  DataSourceProcessor,
  type AcquisitionTask,
  type PreparedMediaFile,
} from '@/core/datasource/core/BaseDataSourceProcessor'
import { RuntimeStateActions, SourceOrigin } from '@/core/datasource/core/BaseDataSource'
import { DataSourceHelpers } from '@/core/datasource/core/DataSourceHelpers'
import { fetchClient, sleepWithAbortSignal } from '@/utils/fetchClient'
import type { UnifiedMediaItemData, MediaType } from '@/core/mediaitem/types'
import { globalMetaFileManager } from '@/core/managers/media/globalMetaFileManager'
import { DATA_SOURCE_CONCURRENCY } from '@/constants/ConcurrencyConstants'
import { useUnifiedStore } from '@/core/unifiedStore'

// 导入类型定义
import { ContentType, TaskStreamEventType, TaskStatus } from './types'
import type {
  TaskStreamEvent,
  ProgressUpdateEvent,
  FinalEvent,
  ErrorEvent,
  HeartbeatEvent,
  MediaTypeInfo,
  PrepareFileResult,
  TaskResultData,
} from './types'
import { type AIGenerationSourceData, mapContentTypeToMediaType } from './AIGenerationSource'

// ==================== 辅助函数 ====================

/**
 * 根据 ContentType 枚举获取默认的 MIME 类型和文件扩展名
 * @param contentType - ContentType 枚举值
 * @returns 包含 MIME 类型和文件扩展名的对象
 */
function getMediaTypeInfo(contentType: ContentType): MediaTypeInfo {
  switch (contentType) {
    case ContentType.IMAGE:
      return { mimeType: 'image/png', extension: 'png' }
    case ContentType.VIDEO:
      return { mimeType: 'video/mp4', extension: 'mp4' }
    case ContentType.AUDIO:
      return { mimeType: 'audio/mpeg', extension: 'mp3' }
    default:
      return { mimeType: 'application/octet-stream', extension: 'bin' }
  }
}

/**
 * 从 MIME 类型推断文件扩展名
 * @param mimeType - MIME 类型字符串（如 'image/png'）
 * @returns 文件扩展名（不含点号，如 'png'）
 */
function getExtensionFromMimeType(mimeType: string): string {
  const mimeToExt: Record<string, string> = {
    // 图片格式
    'image/png': 'png',
    'image/jpeg': 'jpg',
    'image/jpg': 'jpg',
    'image/gif': 'gif',
    'image/webp': 'webp',
    'image/svg+xml': 'svg',
    'image/bmp': 'bmp',

    // 视频格式
    'video/mp4': 'mp4',
    'video/webm': 'webm',
    'video/ogg': 'ogv',
    'video/quicktime': 'mov',
    'video/x-msvideo': 'avi',

    // 音频格式
    'audio/mpeg': 'mp3',
    'audio/wav': 'wav',
    'audio/ogg': 'ogg',
    'audio/aac': 'aac',
    'audio/flac': 'flac',
    'audio/x-m4a': 'm4a',
  }

  // 标准化 MIME 类型（移除参数部分，如 'image/png; charset=utf-8' -> 'image/png'）
  const normalizedMime = mimeType.toLowerCase().split(';')[0].trim()
  return mimeToExt[normalizedMime] || 'bin'
}

// ==================== AI生成管理器 ====================

/**
 * AI生成处理器 - 管理AI媒体生成任务
 */
export class AIGenerationProcessor extends DataSourceProcessor {
  private static instance: AIGenerationProcessor

  // 🌟 新增：存储每个任务的 AbortController
  private abortControllers: Map<string, AbortController> = new Map()
  private dagPrepareState = new Map<
    string,
    { needSaveMeta: boolean; needSaveMedia: boolean }
  >()

  /**
   * 获取单例实例
   */
  static getInstance(): AIGenerationProcessor {
    if (!this.instance) {
      this.instance = new AIGenerationProcessor()
    }
    return this.instance
  }

  /**
   * 私有构造函数，确保单例模式
   */
  private constructor() {
    super()
    // AI生成需要限制并发数
    this.maxConcurrentTasks = DATA_SOURCE_CONCURRENCY.AI_GENERATION_MAX_CONCURRENT_TASKS
  }

  // ==================== 实现抽象方法 ====================

  /**
   * 执行具体的获取任务。
   *
   * @deprecated 仅保留给旧 Processor 队列主链。AI 生成新链路优先通过
   * AIGeneratedMediaResolver 和 DAG 拆分接口推进。
   */
  protected async executeTask(task: AcquisitionTask): Promise<void> {
    const mediaItem = task.mediaItem

    console.log(`🎬 [AIGenerationProcessor] 开始执行任务: ${task.id} - ${mediaItem.name}`)

    // executeTask 内部调用 processMediaItem
    await this.processMediaItem(mediaItem)

    // 检查执行结果 - 通过检查错误信息来判断状态
    const source = task.mediaItem.source as AIGenerationSourceData
    if (source.errorMessage) {
      throw new Error(source.errorMessage)
    }

    console.log(`✅ [AIGenerationProcessor] 任务执行成功: ${task.id}`)
  }

  /**
   * 获取处理器类型
   */
  getProcessorType(): string {
    return 'ai-generation'
  }

  // ==================== AI生成特定行为方法 ====================

  /**
   * 进度流处理（使用fetchClient的stream方法）
   * @param aiTaskId 任务ID
   * @param mediaItem 媒体项目
   * @returns 生成的文件对象
   */
  private async startProgressStream(
    aiTaskId: string,
    mediaItem: UnifiedMediaItemData,
  ): Promise<File> {
    const source = mediaItem.source as AIGenerationSourceData
    // 🌟 创建 AbortController
    const abortController = new AbortController()
    this.abortControllers.set(aiTaskId, abortController)

    return new Promise(async (resolve, reject) => {
      // 🌟 开始监听进度流时，设置任务状态为进行中
      console.log(`🔄 [AIGenerationProcessor] 开始监听进度流，设置状态为 PROCESSING`)
      let needReconnect = true
      let delayTime = 1
      try {
        while (needReconnect) {
          // 使用fetchClient的stream方法处理NDJSON流
          await fetchClient
            .stream(
              'GET',
              `/api/media/tasks/${aiTaskId}/status`,
              (streamEvent: TaskStreamEvent): boolean | void => {
                // 处理进度更新
                if (streamEvent.type === TaskStreamEventType.PROGRESS_UPDATE) {
                  console.log(`🎬 [AIGenerationProcessor] 任务进度更新:`, streamEvent)
                  const shouldTransition = this.handleProgressUpdate(source, streamEvent)

                  // handleProgressUpdate 内部已判断是否需要转换（PENDING -> PROCESSING）
                  if (shouldTransition) {
                    console.log(
                      `🔄 [AIGenerationProcessor] 任务状态从 PENDING 转换到 PROCESSING，设置媒体状态为 asyncprocessing`,
                    )
                    this.transitionMediaStatus(mediaItem, 'asyncprocessing')
                  }
                  return false
                }
                // 处理生成完成
                else if (streamEvent.type === TaskStreamEventType.FINAL) {
                  console.log(`📋 [AIGenerationProcessor] FINAL 事件状态: ${streamEvent.status}`)

                  // 如果是失败或取消状态，设置状态并拒绝
                  if (streamEvent.status === TaskStatus.FAILED) {
                    source.taskStatus = TaskStatus.FAILED
                    console.error(`❌ [AIGenerationProcessor] 任务失败，状态: FAILED`)
                    reject(new Error(streamEvent.message))
                    needReconnect = false
                    return true
                  } else if (streamEvent.status === TaskStatus.CANCELLED) {
                    source.taskStatus = TaskStatus.CANCELLED
                    console.warn(`⚠️ [AIGenerationProcessor] 任务已取消，状态: CANCELLED`)
                    reject(new Error(streamEvent.message))
                    needReconnect = false
                    return true
                  }

                  // ✅ 直接从 FINAL 事件中获取 result_data（无需额外 API 调用）
                  if (!streamEvent.result_data) {
                    console.error(`❌ [AIGenerationProcessor] FINAL 事件中缺少 result_data`)
                    reject(new Error('FINAL 事件中缺少 result_data'))
                    needReconnect = false
                    return true
                  }

                  this.handleFinalResult(aiTaskId, streamEvent.result_data, source)
                    .then(resolve)
                    .catch(reject)
                  needReconnect = false
                  return true
                } else if (streamEvent.type === TaskStreamEventType.HEARTBEAT) {
                  // 心跳事件，保持连接活跃，无需处理
                  return false
                } else if (streamEvent.type === TaskStreamEventType.NOT_FOUND) {
                  console.error(`❌ [AIGenerationProcessor] 进度流错误: ${streamEvent.message}`)
                  reject(new Error(streamEvent.message))
                  needReconnect = false
                  return true
                }
                // 处理错误
                else if (streamEvent.type === TaskStreamEventType.ERROR) {
                  // 🌟 ERROR 事件表示进度流系统错误（如权限问题、流异常），不是任务失败，不修改 taskStatus
                  console.error(`❌ [AIGenerationProcessor] 进度流错误: ${streamEvent.message}`)
                  return true
                }

                // 默认继续读取流
                return false
              },
              undefined,
              { signal: abortController.signal }, // 🌟 传入 signal
            )
            .catch((error) => {
              console.log(`⚠️ [AIGenerationProcessor] 进度流连接中断: ${error.message}`)
            })
          // 只有需要重连时才延迟
          if (needReconnect) {
            console.log(`🔄 [AIGenerationProcessor]准备重连...`)
            const jitter = delayTime * 0.2 * (Math.random() * 2 - 1)
            const actualDelay = Math.max(0, delayTime + jitter)
            await sleepWithAbortSignal(actualDelay * 1000, abortController.signal)
            delayTime = Math.min(delayTime * 2, 60) // 指数退避，最大60秒
          }
        }
      } finally {
        // 🌟 清理 AbortController
        this.abortControllers.delete(aiTaskId)
        console.log(`🧹 [清理] 已清理 AbortController: ${aiTaskId}`)
      }
    })
  }

  /**
   * 处理进度更新
   * @returns 返回是否需要转换媒体状态（从 PENDING 转换到 PROCESSING 时返回 true）
   */
  private handleProgressUpdate(
    source: AIGenerationSourceData,
    streamEvent: ProgressUpdateEvent,
  ): boolean {
    const oldStatus = source.taskStatus
    let hasChanges = false

    // 只在进度值真正变化时更新
    if (source.progress !== streamEvent.progress) {
      source.progress = streamEvent.progress
    }

    // 只在状态真正变化时更新
    if (source.taskStatus !== streamEvent.status) {
      source.taskStatus = streamEvent.status
    }

    // 判断是否需要转换媒体状态：只在从 PENDING 转换到 PROCESSING 时返回 true
    return oldStatus === TaskStatus.PENDING && streamEvent.status === TaskStatus.PROCESSING
  }

  /**
   * 处理 FINAL 结果
   * @returns 生成的文件对象
   */
  private async handleFinalResult(
    taskId: string,
    resultData: TaskResultData,
    source: AIGenerationSourceData,
  ): Promise<File> {
    // 保存 resultData 到 source（持久化字段）
    source.resultData = resultData

    // 🌟 获取到 resultData 表示远程任务已完成，设置 COMPLETED 状态
    source.taskStatus = TaskStatus.COMPLETED
    console.log(`✅ [AIGenerationProcessor] 远程任务完成，获取到 resultData，状态: COMPLETED`)

    // 从 resultData 中提取 URL
    const resultUrl = resultData.url
    if (!resultUrl) {
      throw new Error('resultData 中缺少 url 字段')
    }

    let file: File
    if (this.isRemotePath(resultUrl)) {
      // 远程文件：直接下载
      file = await this.downloadRemoteFile(taskId, resultUrl, source)
    } else {
      // 本地文件：调用 /tasks/{id}/file
      file = await this.fetchLocalFile(taskId, source)
    }

    // 发送系统通知
    const unifiedStore = useUnifiedStore()
    await unifiedStore.notifySystem('AI 生成完成', '您的媒体文件已成功生成')

    return file
  }

  /**
   * 判断是否为远程路径
   */
  private isRemotePath(path: string): boolean {
    return path.startsWith('http://') || path.startsWith('https://')
  }

  /**
   * 下载远程文件
   * @param taskId - 任务ID
   * @param remoteUrl - 远程文件URL
   * @param source - AI生成数据源
   * @returns 生成的文件对象
   */
  private async downloadRemoteFile(
    taskId: string,
    remoteUrl: string,
    source: AIGenerationSourceData,
  ): Promise<File> {
    try {
      const response = await fetch(remoteUrl)
      if (!response.ok) {
        throw new Error(`下载失败: ${response.statusText}`)
      }

      const blob = await response.blob()

      // 🌟 新逻辑：优先使用 blob.type，其次使用 requestParams.content_type
      let mimeType: string
      let extension: string

      if (blob.type) {
        // 优先：从实际下载的文件获取 MIME 类型
        mimeType = blob.type
        extension = getExtensionFromMimeType(mimeType)
        console.log(`📦 [AIGenerationProcessor] 使用 blob.type: ${mimeType}`)
      } else {
        // 备选：从请求参数的 content_type 推断
        const mediaTypeInfo = getMediaTypeInfo(source.requestParams.content_type)
        mimeType = mediaTypeInfo.mimeType
        extension = mediaTypeInfo.extension
        console.log(`📦 [AIGenerationProcessor] 使用 content_type 推断: ${mimeType}`)
      }

      const file = new File([blob], `ai_generation_${taskId}.${extension}`, {
        type: mimeType,
      })

      await RuntimeStateActions.completeAcquisition(source)
      console.log(
        `✅ [AIGenerationProcessor] 远程文件下载成功: ${remoteUrl}, MIME: ${mimeType}, 扩展名: ${extension}`,
      )
      return file
    } catch (error) {
      throw new Error(`下载远程文件失败: ${error instanceof Error ? error.message : '未知错误'}`)
    }
  }

  /**
   * 下载本地文件（调用新接口）
   * @param taskId - 任务ID
   * @param source - AI生成数据源
   * @returns 生成的文件对象
   */
  private async fetchLocalFile(taskId: string, source: AIGenerationSourceData): Promise<File> {
    try {
      // 调用新接口 /tasks/{id}/file
      const response = await fetchClient.get(`/api/media/tasks/${taskId}/file`, {
        responseType: 'blob',
      })

      if (response.status !== 200) {
        throw new Error(`获取结果失败: ${response.statusText}`)
      }

      const blob = response.data as Blob

      // 🌟 新逻辑：与 downloadRemoteFile 保持一致
      let mimeType: string
      let extension: string

      if (blob.type) {
        mimeType = blob.type
        extension = getExtensionFromMimeType(mimeType)
        console.log(`📦 [AIGenerationProcessor] 使用 blob.type: ${mimeType}`)
      } else {
        const mediaTypeInfo = getMediaTypeInfo(source.requestParams.content_type)
        mimeType = mediaTypeInfo.mimeType
        extension = mediaTypeInfo.extension
        console.log(`📦 [AIGenerationProcessor] 使用 content_type 推断: ${mimeType}`)
      }

      const file = new File([blob], `ai_generation_${taskId}.${extension}`, {
        type: mimeType,
      })

      await RuntimeStateActions.completeAcquisition(source)
      console.log(
        `✅ [AIGenerationProcessor] 本地文件获取成功: ${taskId}, MIME: ${mimeType}, 扩展名: ${extension}`,
      )
      return file
    } catch (error) {
      throw new Error(`获取本地文件失败: ${error instanceof Error ? error.message : '未知错误'}`)
    }
  }

  /**
   * 为媒体项目准备文件
   * 支持三种场景：
   * - 场景A：任务已完成并下载到本地 -> 从 media/{id} 加载
   * - 场景B：本地文件不存在但有 resultPath -> 直接从 resultPath 获取结果（无需进度流）
   * - 场景C：有 aiTaskId，任务进行中 -> startProgressStream
   *
   * 注意：场景D（提交新任务）已移至 UI 层处理
   *
   * @param mediaItem 媒体项目
   * @returns 文件准备结果
   */
  private async prepareFileForMediaItem(
    mediaItem: UnifiedMediaItemData,
  ): Promise<PrepareFileResult> {
    const source = mediaItem.source as AIGenerationSourceData

    try {
      let file: File
      let mediaType: MediaType | null = null
      let needSaveMeta: boolean
      let needSaveMedia: boolean

      // 🌟 场景判断：优先尝试从本地恢复
      const localFileExists = await globalMetaFileManager.verifyMediaFileExists(mediaItem.id)

      if (localFileExists) {
        // 场景 A: 从本地加载已完成的文件
        this.transitionMediaStatus(mediaItem, 'asyncprocessing')
        console.log(`📂 [场景A] 从项目加载已完成的AI生成文件: ${mediaItem.id}`)
        file = await globalMetaFileManager.loadMediaFile(mediaItem.id)
        needSaveMeta = false // meta 文件已存在
        needSaveMedia = false // 媒体文件已存在
      } else if (source.resultData) {
        // 场景 B: 远程任务已完成，重新获取文件
        this.transitionMediaStatus(mediaItem, 'asyncprocessing')
        console.log(`🎯 [场景B] 远程任务已完成，直接从 resultData 获取:`, source.resultData)
        RuntimeStateActions.startAcquisition(source)

        file = await this.handleFinalResult(source.aiTaskId, source.resultData, source)
        mediaType = mapContentTypeToMediaType(source.requestParams.content_type)

        await RuntimeStateActions.completeAcquisition(source)
        needSaveMeta = true // 需要更新 meta 文件
        needSaveMedia = true // 需要保存新获取的媒体文件
      } else {
        // 场景 C: 监听进行中的任务
        if (!source.aiTaskId) {
          throw new Error('AI任务ID不存在，任务应该在UI层提交')
        }

        console.log(`🔄 [场景C] 监听进行中的AI任务: ${source.aiTaskId}`)

        if (source.taskStatus === TaskStatus.FAILED) {
          throw new Error('AI任务已失败，无法继续')
        }

        if (source.taskStatus === TaskStatus.CANCELLED) {
          throw new Error('AI任务已取消，无法继续')
        }

        RuntimeStateActions.startAcquisition(source)

        file = await this.startProgressStream(source.aiTaskId, mediaItem)
        mediaType = mapContentTypeToMediaType(source.requestParams.content_type)

        await RuntimeStateActions.completeAcquisition(source)
        needSaveMeta = true // 需要保存 meta 文件
        needSaveMedia = true // 需要保存新生成的媒体文件
      }

      return { success: true, file, mediaType, needSaveMeta, needSaveMedia }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'AI生成失败'
      RuntimeStateActions.setError(source, errorMessage)

      // 🌟 关键改动：不再抛出错误，而是返回失败结果
      // 失败时也要保存 meta，以持久化失败状态
      return {
        success: false,
        error: errorMessage,
        needSaveMeta: true, // 失败也要保存 meta，记录 FAILED 状态
      }
    }
  }

  // ==================== 新增：实现统一媒体项目处理 ====================

  /**
   * 处理完整的媒体项目生命周期
   *
   * @deprecated 兼容旧 Processor 主链的聚合入口。当前 DAG 仍复用其内部共享逻辑，
   * 但新业务入口不应再直接依赖该方法。
   * @param mediaItem 媒体项目
   */
  async processMediaItem(mediaItem: UnifiedMediaItemData): Promise<void> {
    const source = mediaItem.source as AIGenerationSourceData

    try {
      console.log(`🚀 [AIGenerationProcessor] 开始处理媒体项目: ${mediaItem.name}`)

      // 1. 状态转换
      if (mediaItem.mediaStatus === 'missing') {
        console.log(`🔄 [AIGenerationProcessor] 媒体文件缺失，先转换到 pending: ${mediaItem.name}`)
        this.transitionMediaStatus(mediaItem, 'pending')
      } else if (mediaItem.mediaStatus === 'cancelled') return
      else if (mediaItem.mediaStatus === 'error') return

      // 2. USER_CREATE 预保存 meta 文件
      if (DataSourceHelpers.isUserCreate(source)) {
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

      // 3. 🌟 执行文件准备
      const prepareResult = await this.prepareFileForMediaItem(mediaItem)

      // 4. 🌟 处理失败情况
      if (!prepareResult.success) {
        this.transitionMediaStatus(mediaItem, 'error')
        source.errorMessage = prepareResult.error

        // 🌟 失败时保存 meta 文件（持久化 FAILED 状态）
        if (prepareResult.needSaveMeta) {
          console.log(`💾 [失败处理] 保存失败状态的Meta文件: ${mediaItem.name}`)
          await globalMetaFileManager.saveMetaFile(mediaItem)
        }

        return
      }

      // 5. 🌟 成功情况：继续处理
      const { file, mediaType, needSaveMeta, needSaveMedia } = prepareResult

      if (mediaType !== null) {
        mediaItem.mediaType = mediaType
      }

      // 6. 解析处理
      this.transitionMediaStatus(mediaItem, 'decoding')
      const bunnyResult = await this.bunnyProcessor.processMedia(mediaItem, file)

      // 7. 直接设置元数据
      mediaItem.runtime.bunny = bunnyResult.bunnyObjects
      mediaItem.duration = Number(bunnyResult.durationN)
      console.log(`🔧 [AIGenerationProcessor] 元数据设置完成: ${mediaItem.name}`)

      // 8. 🌟 根据标志决定保存策略（分别调用 saveMediaFile 和 saveMetaFile）
      if (needSaveMedia) {
        console.log(`💾 [保存媒体] 保存媒体文件: ${mediaItem.name}`)
        const saveMediaSuccess = await globalMetaFileManager.saveMediaFile(file, mediaItem.id)
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
      console.log(`✅ [AIGenerationProcessor] 媒体项目处理完成: ${mediaItem.name}`)
    } catch (error) {
      console.error(`❌ [AIGenerationProcessor] 媒体项目处理失败: ${mediaItem.name}`, error)
      this.transitionMediaStatus(mediaItem, 'error')
      source.errorMessage = error instanceof Error ? error.message : '处理失败'

      // 🌟 保存失败状态的 meta 文件
      console.log(`💾 [异常处理] 保存失败状态的Meta文件: ${mediaItem.name}`)
      await globalMetaFileManager.saveMetaFile(mediaItem)
    }
  }

  async prepareMediaFileForDag(mediaItem: UnifiedMediaItemData): Promise<PreparedMediaFile> {
    const prepareResult = await this.prepareFileForMediaItem(mediaItem)

    if (!prepareResult.success) {
      const source = mediaItem.source as AIGenerationSourceData
      this.transitionMediaStatus(mediaItem, 'error')
      source.errorMessage = prepareResult.error

      if (prepareResult.needSaveMeta) {
        await globalMetaFileManager.saveMetaFile(mediaItem)
      }

      throw new Error(prepareResult.error)
    }

    this.dagPrepareState.set(mediaItem.id, {
      needSaveMeta: prepareResult.needSaveMeta,
      needSaveMedia: prepareResult.needSaveMedia,
    })

    return {
      file: prepareResult.file,
      mediaType: prepareResult.mediaType,
    }
  }

  async decodePreparedMediaFileForDag(
    mediaItem: UnifiedMediaItemData,
    preparedFile: PreparedMediaFile,
  ): Promise<void> {
    const source = mediaItem.source as AIGenerationSourceData
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
      console.log(`🔧 [AIGenerationProcessor] DAG 元数据设置完成: ${mediaItem.name}`)

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
      console.error(`❌ [AIGenerationProcessor] DAG 解码失败: ${mediaItem.name}`, error)
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
   * 只能取消 pending 状态的任务
   * @param taskId 任务ID
   * @returns 是否成功取消
   */
  async cancelTask(taskId: string): Promise<boolean> {
    const task = this.tasks.get(taskId)
    if (!task) {
      console.warn(`⚠️ [AIGenerationProcessor] 任务不存在: ${taskId}`)
      return false
    }

    // 检查状态是否为 pending
    if (task.mediaItem.mediaStatus !== 'pending') {
      console.warn(
        `⚠️ [AIGenerationProcessor] 只能取消 pending 状态的任务，当前状态: ${task.mediaItem.mediaStatus}`,
      )
      return false
    }

    const source = task.mediaItem.source as AIGenerationSourceData
    const aiTaskId = source.aiTaskId

    try {
      // 1. 先调用后端 API 取消远程任务
      if (aiTaskId) {
        const cancelSuccess = await this.cancelRemoteTask(aiTaskId)
        if (!cancelSuccess) {
          console.warn(`⚠️ [AIGenerationProcessor] 后端任务取消失败，不更新本地状态: ${aiTaskId}`)
          return false
        }
      }

      // 2. 后端取消成功后，中断流式连接（如果存在）
      const abortController = this.abortControllers.get(aiTaskId)
      if (abortController) {
        console.log(`🛑 [AIGenerationProcessor] 中断进度流: ${aiTaskId}`)
        abortController.abort()
        // 🌟 立即清理 AbortController，避免依赖异步 finally
        this.abortControllers.delete(aiTaskId)
      }

      // 3. 设置为 cancelled 状态
      this.transitionMediaStatus(task.mediaItem, 'cancelled')
      source.taskStatus = TaskStatus.CANCELLED // 🌟 同时设置 source.taskStatus
      source.errorMessage = '任务已取消'

      // 4. 保存 cancelled 状态到 meta 文件
      await globalMetaFileManager.saveMetaFile(task.mediaItem)
      console.log(`💾 [AIGenerationProcessor] 已保存 cancelled 状态到 meta: ${task.mediaItem.name}`)

      console.log(`✅ [AIGenerationProcessor] 任务取消成功: ${aiTaskId}`)
      return true
    } catch (error) {
      console.error(`❌ [AIGenerationProcessor] 取消任务失败: ${aiTaskId}`, error)
      return false
    }
  }

  /**
   * 调用后端 API 取消远程任务
   * @param aiTaskId AI任务ID
   * @returns 是否成功取消
   */
  private async cancelRemoteTask(aiTaskId: string): Promise<boolean> {
    try {
      console.log(`🌐 [AIGenerationProcessor] 调用后端 API 取消任务: ${aiTaskId}`)

      const response = await fetchClient.delete(`/api/media/tasks/${aiTaskId}`)

      if (response.status === 200) {
        console.log(`✅ [AIGenerationProcessor] 后端任务取消成功: ${aiTaskId}`)
        return true
      } else {
        console.warn(`⚠️ [AIGenerationProcessor] 后端任务取消失败: ${response.statusText}`)
        return false
      }
    } catch (error) {
      console.error(`❌ [AIGenerationProcessor] 调用后端 API 失败: ${aiTaskId}`, error)
      return false
    }
  }
}
