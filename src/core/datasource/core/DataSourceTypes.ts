/**
 * 统一数据源联合类型、工厂和查询函数。
 */

import type {
  UserSelectedFileSourceData,
  BaseUserSelectedFileSourceData,
} from '@/core/datasource/providers/user-selected/UserSelectedFileSource'
import type {
  AIGenerationSourceData,
  BaseAIGenerationSourceData,
} from '@/core/datasource/providers/ai-generation/AIGenerationSource'
import type {
  BizyAirSourceData,
  BaseBizyAirSourceData,
} from '@/core/datasource/providers/bizyair/BizyAirSource'
import type {
  ASRSourceData,
  BaseASRSourceData,
} from '@/core/datasource/providers/asr/ASRSource'
import { UserSelectedFileSourceFactory } from '@/core/datasource/providers/user-selected/UserSelectedFileSource'
import { AIGenerationSourceFactory } from '@/core/datasource/providers/ai-generation/AIGenerationSource'
import { ASRSourceFactory } from '@/core/datasource/providers/asr/ASRSource'
import { UserSelectedFileTypeGuards } from '@/core/datasource/providers/user-selected/UserSelectedFileSource'
import { AIGenerationTypeGuards } from '@/core/datasource/providers/ai-generation/AIGenerationSource'
import { BizyAirTypeGuards } from '@/core/datasource/providers/bizyair/BizyAirSource'
import { ASRTypeGuards } from '@/core/datasource/providers/asr/ASRSource'
import {
  RuntimeStateQueries as BaseDataSourceQueries,
  SourceOrigin,
} from '@/core/datasource/core/BaseDataSource'
import { extractUserSelectedFileSourceData } from '@/core/datasource/providers/user-selected/UserSelectedFileSource'
import { extractAIGenerationSourceData } from '@/core/datasource/providers/ai-generation/AIGenerationSource'
import { extractBizyAirSourceData } from '@/core/datasource/providers/bizyair/BizyAirSource'
import { extractASRSourceData } from '@/core/datasource/providers/asr/ASRSource'

// ==================== 联合类型定义 ====================

/**
 * 统一数据源联合类型
 */
export type UnifiedDataSourceData =
  | UserSelectedFileSourceData
  | AIGenerationSourceData
  | BizyAirSourceData
  | ASRSourceData

/**
 * 可持久化的数据源联合类型。
 */
export type BaseDataSourcePersistedData =
  | BaseUserSelectedFileSourceData
  | BaseAIGenerationSourceData
  | BaseBizyAirSourceData
  | BaseASRSourceData

// ==================== 统一工厂函数 ====================

/**
 * 统一数据源工厂函数
 */
export const DataSourceFactory = {
  /**
   * 从文件对象创建用户选择文件数据源
   */
  createUserSelectedSourceFromFile(file: File): UserSelectedFileSourceData {
    return UserSelectedFileSourceFactory.createFromFile(file)
  },

  /**
   * 从保存的基础数据重建用户选择文件数据源
   */
  createUserSelectedSourceFromBaseData(
    baseData: BaseUserSelectedFileSourceData,
  ): UserSelectedFileSourceData {
    return UserSelectedFileSourceFactory.createFromBaseData(baseData)
  },

  /**
   * 创建AI生成数据源
   * @param param 基础数据
   * @param origin 数据源来源标识（必须明确传入）
   */
  createAIGenerationSource(
    param: BaseAIGenerationSourceData,
    origin: SourceOrigin,
  ): AIGenerationSourceData {
    return AIGenerationSourceFactory.createAIGenerationSource(param, origin)
  },

  /**
   * 创建 ASR 数据源
   * @param param 基础数据
   * @param origin 数据源来源标识（必须明确传入）
   */
  createASRSource(
    param: BaseASRSourceData,
    origin: SourceOrigin,
  ): ASRSourceData {
    return ASRSourceFactory.createASRSource(param, origin)
  },
}

// ==================== 数据源提取函数 ====================

/**
 * 根据数据源类型提取持久化数据
 */
export function extractSourceData(source: UnifiedDataSourceData): BaseDataSourcePersistedData {
  if (DataSourceQueries.isUserSelectedSource(source)) {
    return extractUserSelectedFileSourceData(source)
  } else if (DataSourceQueries.isAIGenerationSource(source)) {
    return extractAIGenerationSourceData(source)
  } else if (DataSourceQueries.isBizyAirSource(source)) {
    return extractBizyAirSourceData(source)
  } else if (DataSourceQueries.isASRSource(source)) {
    return extractASRSourceData(source)
  } else {
    console.warn('未知的数据源类型:', source)
    throw new Error('未知的数据源类型')
  }
}

// ==================== 统一查询函数 ====================

/**
 * 数据源查询函数集合。
 */
export const DataSourceQueries = {
  // 继承基础查询函数
  ...BaseDataSourceQueries,

  // 类型查询 - 直接使用具体类型守卫，避免额外封装层
  isUserSelectedSource(source: UnifiedDataSourceData): source is UserSelectedFileSourceData {
    return UserSelectedFileTypeGuards.isUserSelectedSource(source)
  },

  isAIGenerationSource(source: UnifiedDataSourceData): source is AIGenerationSourceData {
    return AIGenerationTypeGuards.isAIGenerationSource(source)
  },

  isBizyAirSource(source: UnifiedDataSourceData): source is BizyAirSourceData {
    return BizyAirTypeGuards.isBizyAirSource(source)
  },

  isASRSource(source: UnifiedDataSourceData): source is ASRSourceData {
    return ASRTypeGuards.isASRSource(source)
  },
}
