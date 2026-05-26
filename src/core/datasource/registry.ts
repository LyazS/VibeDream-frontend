/**
 * datasource 执行器注册表。
 *
 * 负责按 `source.type` 注册和分发具体执行器。
 */

import {
  DataSourceProcessor,
} from '@/core/datasource/core/BaseDataSourceProcessor'
import { UserSelectedFileProcessor } from '@/core/datasource/providers/user-selected/UserSelectedFileProcessor'
import { AIGenerationProcessor } from '@/core/datasource/providers/ai-generation/AIGenerationProcessor'
import { BizyAirProcessor } from '@/core/datasource/providers/bizyair/BizyAirProcessor'

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

  // ==================== 执行器注册 ====================

  /**
   * 注册执行器
   */
  register(type: string, processor: DataSourceProcessor): void {
    if (this.processors.has(type)) {
      console.warn(`执行器类型 "${type}" 已存在，将被覆盖`)
    }

    this.processors.set(type, processor)
    console.log(`已注册 datasource 执行器: ${type}`)
  }

  /**
   * 获取执行器
   */
  getProcessor(type: string): DataSourceProcessor | undefined {
    return this.processors.get(type)
  }

  // ==================== 默认执行器初始化 ====================

  /**
   * 初始化默认执行器
   */
  private initializeDefaultProcessors(): void {
    // 注册用户选择文件执行器
    this.register('user-selected', UserSelectedFileProcessor.getInstance())

    // 注册 AI 生成执行器
    this.register('ai-generation', AIGenerationProcessor.getInstance())

    // 注册 BizyAir 执行器
    this.register('bizyair', BizyAirProcessor.getInstance())
  }

}

// ==================== 导出便捷函数 ====================

/**
 * 获取数据源注册中心实例
 */
export function getDataSourceRegistry(): DataSourceRegistry {
  return DataSourceRegistry.getInstance()
}
