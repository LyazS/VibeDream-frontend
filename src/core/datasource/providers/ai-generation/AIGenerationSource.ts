/**
 * AI 生成 datasource 类型定义、工厂和查询函数。
 */

import type {
  BaseDataSourceData,
  DataSourceRuntimeState,
} from '@/core/datasource/core/BaseDataSource'
import { reactive } from 'vue'
import { RuntimeStateFactory, SourceOrigin } from '@/core/datasource/core/BaseDataSource'

// 导出所有类型定义
export * from './types'

// 导入枚举（作为值）和类型
import { AITaskType, ContentType, TaskStatus, TaskStreamEventType } from './types'

import type { MediaGenerationRequest, TaskResultData } from './types'

// ==================== 数据源接口定义 ====================

/**
 * AI 生成 datasource 的持久化数据。
 */
export interface BaseAIGenerationSourceData extends BaseDataSourceData {
  type: 'ai-generation'
  aiTaskId: string
  requestParams: MediaGenerationRequest
  resultData?: TaskResultData // 远程任务完成后的结果数据
  taskStatus: TaskStatus
}

/**
 * AI 生成 datasource 运行时结构。
 */
export interface AIGenerationSourceData
  extends BaseAIGenerationSourceData,
    DataSourceRuntimeState {}

// ==================== 工厂函数 ====================

/**
 * AI生成数据源工厂函数
 */
export const AIGenerationSourceFactory = {
  /**
   * 创建 AI 生成 datasource
   * @param param 基础数据
   * @param origin 数据源来源标识
   */
  createAIGenerationSource(
    param: BaseAIGenerationSourceData,
    origin: SourceOrigin,
  ): AIGenerationSourceData {
    return reactive({
      ...param,
      ...RuntimeStateFactory.createRuntimeState(origin),
    }) as AIGenerationSourceData
  },
}

// ==================== 类型守卫 ====================

/**
 * AI 生成类型守卫
 */
export const AIGenerationTypeGuards = {
  isAIGenerationSource(source: BaseDataSourceData): source is AIGenerationSourceData {
    return source.type === 'ai-generation'
  },
}

// ==================== AI 生成查询函数 ====================

/**
 * AI 生成查询函数。
 */
export const AIGenerationQueries = {
  /**
   * 获取 AI 任务 ID
   */
  getAITaskId(source: BaseDataSourceData): string | null {
    return AIGenerationTypeGuards.isAIGenerationSource(source) ? source.aiTaskId : null
  },

  /**
   * 获取任务状态
   */
  getTaskStatus(source: AIGenerationSourceData): TaskStatus | undefined {
    return source.taskStatus
  },

  /**
   * 获取请求参数
   */
  getRequestParams(source: AIGenerationSourceData): MediaGenerationRequest {
    return source.requestParams
  },
}

// ==================== 数据源提取函数 ====================

/**
 * 提取AI生成数据源的持久化数据
 */
export function extractAIGenerationSourceData(
  source: AIGenerationSourceData,
): BaseAIGenerationSourceData {
  return {
    type: source.type,
    aiTaskId: source.aiTaskId,
    requestParams: source.requestParams,
    resultData: source.resultData,
    taskStatus: source.taskStatus,
  }
}

/**
 * 映射内容类型到媒体类型
 */
export function mapContentTypeToMediaType(contentType: ContentType): 'image' | 'video' | 'audio' {
  switch (contentType) {
    case ContentType.IMAGE:
      return 'image'
    case ContentType.VIDEO:
      return 'video'
    case ContentType.AUDIO:
      return 'audio'
    default:
      return 'image'
  }
}
