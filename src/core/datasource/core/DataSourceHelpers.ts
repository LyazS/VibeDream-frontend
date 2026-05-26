/**
 * 数据源辅助函数。
 */

import type { UnifiedDataSourceData } from './DataSourceTypes'
import { SourceOrigin } from './BaseDataSource'

/**
 * 数据源辅助函数
 */
export const DataSourceHelpers = {
  /**
   * 判断是否是用户创建
   */
  isUserCreate(source: UnifiedDataSourceData): boolean {
    return source.sourceOrigin === SourceOrigin.USER_CREATE
  },

  /**
   * 判断是否从项目加载
   */
  isProjectLoad(source: UnifiedDataSourceData): boolean {
    return source.sourceOrigin === SourceOrigin.PROJECT_LOAD
  },

  /**
   * 获取来源描述（用于日志）
   */
  getOriginDescription(origin: SourceOrigin): string {
    return origin === SourceOrigin.USER_CREATE ? '用户创建' : '项目加载'
  },
}
