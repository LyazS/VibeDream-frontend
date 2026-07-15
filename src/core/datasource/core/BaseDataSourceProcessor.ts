/**
 * 数据源处理器基类。
 *
 * 当前职责是承载各类 datasource 的共享执行能力，并向 Resource DAG 暴露统一接口。
 */

import type { UnifiedMediaItemData, MediaStatus, MediaType } from '@/core/mediaitem/types'
import { MediaStatusManager } from '@/core/datasource/services/MediaStatusService'
import { BunnyProcessor } from '@/core/bunnyUtils/BunnyProcessor'

export interface PreparedMediaFile {
  file: File
  mediaType: MediaType | null
}

// ==================== 数据源处理器基础抽象类 ====================

/**
 * 数据源处理器抽象基类。
 */
export abstract class DataSourceProcessor {
  // 服务实例
  protected mediaStatusManager: MediaStatusManager = new MediaStatusManager()
  protected bunnyProcessor: BunnyProcessor = new BunnyProcessor()

  // ==================== 公共接口 ====================

  /**
   * 由 Resource DAG 调用的直接执行入口。
   */
  abstract processTaskDirectly(mediaItem: UnifiedMediaItemData): Promise<void>

  /**
   * Resource DAG 拆分阶段使用：准备当前媒体对应的 File。
   *
   * 默认抛错；只有支持 `media-file-available` 节点的数据源处理器需要实现。
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

  // ==================== 抽象方法 ====================

  /**
   * 获取执行器类型。
   */
  abstract getProcessorType(): string

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
