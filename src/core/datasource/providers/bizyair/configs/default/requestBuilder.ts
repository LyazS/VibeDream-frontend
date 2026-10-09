/**
 * 默认配置组的请求构建器
 *
 * 此配置组使用默认的请求构建逻辑。
 * 如果将来需要特殊的处理逻辑，可以在此文件中实现自定义的 buildRequestData 函数。
 */

import type { BizyAirAppConfig } from '../../types'
import { BizyAirRequestBuilder } from '../../BizyAirRequestBuilder'

// 请求构建器标识符
export const BUILDER_ID = 'default'

export function buildRequestData(
  taskConfig: Record<string, unknown>,
  appConfig: BizyAirAppConfig,
): Record<string, unknown> {
  /**
   * 默认配置组的请求构建器
   *
   * 当前实现：直接使用 BizyAirRequestBuilder。
   *
   * 如果需要自定义逻辑，可以在此处实现。
   *
   * @param taskConfig - 用户任务配置
   * @param appConfig - 应用配置
   * @returns 请求数据字典
   */
  // 直接使用 BizyAirRequestBuilder
  return BizyAirRequestBuilder.build(taskConfig, appConfig)
}
