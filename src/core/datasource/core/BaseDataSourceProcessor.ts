/**
 * 数据源处理器基础类（响应式重构版）
 * 基于"核心数据与行为分离"的重构方案
 * 使用 p-limit 进行并发控制
 */

import type { UnifiedDataSourceData } from '@/core/datasource/core/DataSourceTypes'
import type { UnifiedMediaItemData, MediaStatus, MediaType } from '@/core/mediaitem/types'
import { MediaStatusManager } from '@/core/datasource/services/MediaStatusService'
import { BunnyProcessor } from '@/core/bunnyUtils/BunnyProcessor'
import { DATA_SOURCE_CONCURRENCY } from '@/constants/ConcurrencyConstants'
import pLimit from 'p-limit'

// ==================== 任务相关接口 ====================

/**
 * 获取任务接口（简化版）
 * 只保留核心必需字段，其他信息通过日志或 mediaItem 状态管理
 */
export interface AcquisitionTask {
  /** 任务唯一标识符 */
  id: string
  /** 关联的媒体项目数据 */
  mediaItem: UnifiedMediaItemData
}

export interface PreparedMediaFile {
  file: File
  mediaType: MediaType | null
}

// ==================== 数据源处理器基础抽象类 ====================

/**
 * 数据源处理器基础抽象类 - 适配响应式数据源
 */
export abstract class DataSourceProcessor {
  // 使用 p-limit 替代手动队列管理
  private limit: ReturnType<typeof pLimit>
  protected maxConcurrentTasks: number = DATA_SOURCE_CONCURRENCY.BASE_MAX_CONCURRENT_TASKS

  // 保留任务映射（用于状态查询）
  protected tasks: Map<string, AcquisitionTask> = new Map()

  // 服务实例
  protected mediaStatusManager: MediaStatusManager = new MediaStatusManager()
  protected bunnyProcessor: BunnyProcessor = new BunnyProcessor()

  constructor() {
    this.limit = pLimit(this.maxConcurrentTasks)
  }

  // ==================== 公共接口 ====================

  /**
   * 添加任务到队列（通过媒体项目）
   *
   * @deprecated 旧 Processor 主链入口。新链路应通过 Resource DAG 进入：
   * UnifiedMediaModule.processMediaSourceDirectly() / prepareMediaFileDirectly() /
   * decodePreparedMediaFileDirectly()。
   * @param mediaItem 媒体项目
   * @returns 任务ID
   */
  addTask(mediaItem: UnifiedMediaItemData): void {
    // 🌟 使用 mediaItem.id 作为 taskId，便于后续通过 mediaId 直接查找和取消任务
    const taskId = mediaItem.id

    const task: AcquisitionTask = {
      id: taskId,
      mediaItem: mediaItem,
    }

    this.tasks.set(taskId, task)

    console.log(`📋 [${this.getProcessorType()}] 任务已加入队列: ${taskId} (${mediaItem.name})`)

    // 使用 p-limit 自动管理并发
    this.executeTaskWithLimit(task)
  }

  /**
   * 由 Resource DAG 调用的直接执行入口。
   *
   * 这条路径不再经过 DataSourceProcessor 自己的 p-limit 队列；并发控制由
   * DagScheduler 负责。这里仍然维护 tasks 映射，是为了兼容现有 cancelTask()
   * 依赖 mediaItem.id 查找任务的实现。
   */
  async processTaskDirectly(mediaItem: UnifiedMediaItemData): Promise<void> {
    const taskId = mediaItem.id
    const task: AcquisitionTask = {
      id: taskId,
      mediaItem,
    }

    this.tasks.set(taskId, task)

    try {
      await this.executeTask(task)
    } finally {
      this.tasks.delete(taskId)
    }
  }

  /**
   * Resource DAG 拆分阶段使用：准备当前媒体对应的 File。
   *
   * 默认抛错，只有支持拆分执行的数据源处理器需要实现。当前第一批实现是
   * user-selected；AI/ASR/BizyAir 后续会按各自资源图单独拆。
   */
  async prepareMediaFileForDag(_mediaItem: UnifiedMediaItemData): Promise<PreparedMediaFile> {
    throw new Error(`${this.getProcessorType()} does not support media-file-available`)
  }

  /**
   * Resource DAG 拆分阶段使用：用已准备好的 File 完成解码、元数据和 ready 状态。
   */
  async decodePreparedMediaFileForDag(
    _mediaItem: UnifiedMediaItemData,
    _preparedFile: PreparedMediaFile,
  ): Promise<void> {
    throw new Error(`${this.getProcessorType()} does not support media-decoded`)
  }

  /**
   * 设置最大并发任务数
   */
  setMaxConcurrentTasks(max: number): void {
    this.maxConcurrentTasks = Math.max(1, max)
    this.limit = pLimit(this.maxConcurrentTasks)
  }

  /**
   * 获取最大并发任务数
   */
  getMaxConcurrentTasks(): number {
    return this.maxConcurrentTasks
  }

  // ==================== 受保护的方法 ====================

  /**
   * 使用 p-limit 执行任务。
   *
   * @deprecated 仅服务旧 Processor 队列主链。DAG 新链路不经过这里。
   */
  private async executeTaskWithLimit(task: AcquisitionTask): Promise<void> {
    // p-limit 自动管理队列和并发
    return this.limit(async () => {
      try {
        // 🌟 重试逻辑由子类的 executeTask() 内部处理
        await this.executeTask(task)
      } catch (error) {
        // 错误已经通过 mediaItem.source.errorMessage 处理
        console.error(`❌ [${this.getProcessorType()}] 任务执行失败: ${task.id}`, error)
      } finally {
        // 清理任务相关的所有引用，防止内存泄漏
        this.tasks.delete(task.id)
      }
    })
  }

  // ==================== 抽象方法 ====================

  /**
   * 执行具体的获取任务 - 子类必须实现。
   *
   * @deprecated 这是旧 Processor 主链的抽象执行入口。后续清理旧链路时，
   * 该入口会被 prepareMediaFileForDag()/decodePreparedMediaFileForDag() 替代。
   */
  protected abstract executeTask(task: AcquisitionTask): Promise<void>

  /**
   * 获取处理器类型 - 子类必须实现
   */
  abstract getProcessorType(): string

  /**
   * 取消任务 - 子类必须实现
   * @param taskId 任务ID
   * @returns 是否成功取消
   */
  abstract cancelTask(taskId: string): Promise<boolean>

  // ==================== 新增统一状态机方法 ====================

  /**
   * 统一状态机转换方法
   * @param mediaItem 媒体项目
   * @param status 目标状态
   */
  protected transitionMediaStatus(mediaItem: UnifiedMediaItemData, status: MediaStatus): void {
    // 避免重复转换到相同状态
    if (mediaItem.mediaStatus === status) {
      console.log(
        `🔄 [${this.getProcessorType()}] 媒体状态已经是 ${status}，跳过转换: ${mediaItem.name}`,
      )
      return
    }

    this.mediaStatusManager.transitionTo(mediaItem, status, { processor: this.getProcessorType() })
  }
}
