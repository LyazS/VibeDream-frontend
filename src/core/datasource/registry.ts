/**
 * 数据源处理器注册中心
 * 提供统一的处理器注册和获取接口
 */

import {
  DataSourceProcessor,
} from '@/core/datasource/core/BaseDataSourceProcessor'
import type { UnifiedDataSourceData } from '@/core/datasource/core/DataSourceTypes'
import type { UnifiedMediaItemData } from '@/core/mediaitem/types'
import { UserSelectedFileProcessor } from '@/core/datasource/providers/user-selected/UserSelectedFileProcessor'
import { AIGenerationProcessor } from '@/core/datasource/providers/ai-generation/AIGenerationProcessor'
import { BizyAirProcessor } from '@/core/datasource/providers/bizyair/BizyAirProcessor'
import { ASRProcessor } from '@/core/datasource/providers/asr/ASRProcessor'

// ==================== 类型定义 ====================

/**
 * 数据源注册中心
 */
export class DataSourceRegistry {
  private static instance: DataSourceRegistry
  private processors: Map<string, DataSourceProcessor> = new Map()

  /**
   * 获取单例实例
   */
  static getInstance(): DataSourceRegistry {
    if (!this.instance) {
      this.instance = new DataSourceRegistry()
      this.instance.initializeDefaultProcessors()
    }
    return this.instance
  }

  /**
   * 私有构造函数，确保单例模式
   */
  private constructor() {}

  // ==================== 处理器注册 ====================

  /**
   * 注册处理器
   */
  register(type: string, processor: DataSourceProcessor): void {
    if (this.processors.has(type)) {
      console.warn(`处理器类型 "${type}" 已存在，将被覆盖`)
    }

    this.processors.set(type, processor)
    console.log(`已注册数据源处理器: ${type}`)
  }

  /**
   * 获取处理器
   */
  getProcessor(type: string): DataSourceProcessor | undefined {
    return this.processors.get(type)
  }

  /**
   * 获取用户选择文件处理器
   *
   * @deprecated 类型专用 getter 属于旧 Processor 访问方式。新链路优先通过
   * getProcessor(source.type) 或 Resource DAG resolver 获取能力。
   */
  getUserSelectedFileProcessor(): UserSelectedFileProcessor | undefined {
    return this.processors.get('user-selected') as UserSelectedFileProcessor | undefined
  }

  /**
   * 获取AI生成处理器
   *
   * @deprecated 类型专用 getter 属于旧 Processor 访问方式。AI 生成新链路应
   * 通过 ai-generated-media / remote-task-* resolver 进入。
   */
  getAIGenerationProcessor(): AIGenerationProcessor | undefined {
    return this.processors.get('ai-generation') as AIGenerationProcessor | undefined
  }

  /**
   * 获取BizyAir处理器
   *
   * @deprecated 类型专用 getter 属于旧 Processor 访问方式。BizyAir 新链路应
   * 通过 ai-generated-media / remote-task-* resolver 进入。
   */
  getBizyAirProcessor(): BizyAirProcessor | undefined {
    return this.processors.get('bizyair') as BizyAirProcessor | undefined
  }

  /**
   * 获取ASR处理器
   */
  getASRProcessor(): ASRProcessor | undefined {
    return this.processors.get('asr') as ASRProcessor | undefined
  }

  /**
   * 获取所有处理器
   */
  getAllProcessors(): Map<string, DataSourceProcessor> {
    return new Map(this.processors)
  }

  /**
   * 检查处理器是否已注册
   */
  hasProcessor(type: string): boolean {
    return this.processors.has(type)
  }

  /**
   * 注销处理器
   */
  unregister(type: string): boolean {
    if (this.processors.has(type)) {
      this.processors.delete(type)
      console.log(`已注销数据源处理器: ${type}`)
      return true
    }
    return false
  }

  /**
   * 获取已注册的处理器类型列表
   */
  getRegisteredTypes(): string[] {
    return Array.from(this.processors.keys())
  }

  // ==================== 默认处理器初始化 ====================

  /**
   * 初始化默认处理器
   */
  private initializeDefaultProcessors(): void {
    // 注册用户选择文件处理器
    this.register('user-selected', UserSelectedFileProcessor.getInstance())

    // 注册AI生成处理器
    this.register('ai-generation', AIGenerationProcessor.getInstance())

    // 注册BizyAir处理器
    this.register('bizyair', BizyAirProcessor.getInstance())

    // 注册ASR处理器
    this.register('asr', ASRProcessor.getInstance())
  }

  // ==================== 便捷方法 ====================

  /**
   * 根据数据源类型获取对应的处理器
   */
  getProcessorForSource(
    source: UnifiedDataSourceData,
  ): DataSourceProcessor | undefined {
    return this.getProcessor(source.type)
  }

  // ==================== 资源管理 ====================

  /**
   * 设置所有处理器的最大并发任务数
   */
  setGlobalMaxConcurrentTasks(max: number): void {
    for (const processor of this.processors.values()) {
      processor.setMaxConcurrentTasks(max)
    }
    console.log(`已设置全局最大并发任务数: ${max}`)
  }

}

// ==================== 导出便捷函数 ====================

/**
 * 获取数据源注册中心实例
 */
export function getDataSourceRegistry(): DataSourceRegistry {
  return DataSourceRegistry.getInstance()
}
