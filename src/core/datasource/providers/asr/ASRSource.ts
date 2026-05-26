/**
 * ASR datasource 类型定义、工厂和提取函数。
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
 * ASR datasource 运行时结构。
 */
export interface ASRSourceData extends BaseASRSourceData, DataSourceRuntimeState {}

// ==================== 工厂函数 ====================

/**
 * ASR 数据源工厂函数
 */
export const ASRSourceFactory = {
  /**
   * 创建 ASR datasource
   * @param param 基础数据
   * @param origin 数据源来源标识
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
    type: source.type,
    asrTaskId: source.asrTaskId,
    requestConfig: source.requestConfig,
    resultData: source.resultData,
    taskStatus: source.taskStatus,
    sourceTimelineItemId: source.sourceTimelineItemId,
    placeholderTimelineItemId: source.placeholderTimelineItemId,

  }
}
