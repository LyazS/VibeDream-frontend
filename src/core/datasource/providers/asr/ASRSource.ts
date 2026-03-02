/**
 * ASR 数据源工厂函数
 * 基于"核心数据与行为分离"的重构方案
 */

import type {
  BaseDataSourceData,
  DataSourceRuntimeState,
} from '@/core/datasource/core/BaseDataSource'
import { reactive } from 'vue'
import { RuntimeStateFactory, SourceOrigin } from '@/core/datasource/core/BaseDataSource'

// 导出所有类型定义
export * from './types'

// 导入类型
import type { BaseASRSourceData } from './types'

// ==================== 数据源接口定义 ====================

/**
 * ASR 数据源 - 继承基类型和运行时状态
 */
export interface ASRSourceData extends BaseASRSourceData, DataSourceRuntimeState {}

// ==================== 工厂函数 ====================

/**
 * ASR 数据源工厂函数
 */
export const ASRSourceFactory = {
  /**
   * 创建 ASR 数据源
   * @param param 基础数据
   * @param origin 数据源来源标识（必须明确传入）
   */
  createASRSource(
    param: BaseASRSourceData,
    origin: SourceOrigin,
  ): ASRSourceData {
    return reactive({
      ...param,
      ...RuntimeStateFactory.createRuntimeState(origin),
    }) as ASRSourceData
  },
}

// ==================== 类型守卫 ====================

/**
 * ASR 类型守卫
 */
export const ASRTypeGuards = {
  isASRSource(source: BaseDataSourceData): source is ASRSourceData {
    return source.type === 'asr'
  },
}

// ==================== 数据源提取函数 ====================

/**
 * 提取 ASR 数据源的持久化数据
 */
export function extractASRSourceData(source: ASRSourceData): BaseASRSourceData {
  return {
    // 基础字段
    type: source.type,

    // ASR 特定字段
    asrTaskId: source.asrTaskId,
    requestConfig: source.requestConfig,
    resultData: source.resultData,
    taskStatus: source.taskStatus,
    sourceTimelineItemId: source.sourceTimelineItemId,
    placeholderTimelineItemId: source.placeholderTimelineItemId,

    // 不需要保存运行时状态
    // progress: source.progress, // 重新加载时会重置
    // errorMessage: source.errorMessage, // 重新加载时会重置
    // sourceOrigin: source.sourceOrigin, // 重新加载时会重新设置
  }
}
