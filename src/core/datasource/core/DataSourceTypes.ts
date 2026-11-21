import {
  extractLinkedFileRecord,
  type LinkedFileSourceData,
  type LinkedFileRecord,
} from '@/core/datasource/providers/linked-file/LinkedFileSource'
/**
 * 统一数据源联合类型、工厂和查询函数。
 */

import type {
  UserSelectedFileSourceData,
  BaseUserSelectedFileSourceData,
} from '@/core/datasource/providers/user-selected/UserSelectedFileSource'
import { UserSelectedFileSourceFactory } from '@/core/datasource/providers/user-selected/UserSelectedFileSource'
import { UserSelectedFileTypeGuards } from '@/core/datasource/providers/user-selected/UserSelectedFileSource'
import { RuntimeStateQueries as BaseDataSourceQueries } from '@/core/datasource/core/BaseDataSource'
import { extractUserSelectedFileSourceData } from '@/core/datasource/providers/user-selected/UserSelectedFileSource'

// ==================== 联合类型定义 ====================

/**
 * 统一数据源联合类型
 */
export type UnifiedDataSourceData = UserSelectedFileSourceData | LinkedFileSourceData

/**
 * 可持久化的数据源联合类型。
 */
export type BaseDataSourcePersistedData = BaseUserSelectedFileSourceData | LinkedFileRecord

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
}

// ==================== 数据源提取函数 ====================

/**
 * 根据数据源类型提取持久化数据
 */
export function extractSourceData(source: UnifiedDataSourceData): BaseDataSourcePersistedData {
  if (DataSourceQueries.isLinkedFileSource(source)) {
    return extractLinkedFileRecord(source)
  }
  if (DataSourceQueries.isUserSelectedSource(source)) {
    return extractUserSelectedFileSourceData(source)
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

  // 类型查询
  isUserSelectedSource(source: UnifiedDataSourceData): source is UserSelectedFileSourceData {
    return UserSelectedFileTypeGuards.isUserSelectedSource(source)
  },

  isLinkedFileSource(source: UnifiedDataSourceData): source is LinkedFileSourceData {
    return source.type === 'linked-file'
  },
}
