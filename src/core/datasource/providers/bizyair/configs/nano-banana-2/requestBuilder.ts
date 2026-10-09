/**
 * nano-banana-2 配置组的请求构建器
 *
 * 使用通用的 arrayurl 类型处理多张图片URL，无需特殊处理。
 */

import type { BizyAirAppConfig } from '../../types'
import { BizyAirRequestBuilder } from '../../BizyAirRequestBuilder'

// 请求构建器标识符（可选）
export const BUILDER_ID = 'nano-banana-2'

export function buildRequestData(
  taskConfig: Record<string, unknown>,
  appConfig: BizyAirAppConfig,
): Record<string, unknown> {
  /**
   * nano-banana-2 配置组的请求构建器
   *
   * 直接使用通用的 BizyAirRequestBuilder，无需特殊处理。
   * ref_images 参数通过 arrayurl 类型在配置文件中定义。
   *
   * @param taskConfig - 用户任务配置
   * @param appConfig - 应用配置
   * @returns 请求数据字典
   */
  // 直接调用通用的请求构建器
  return BizyAirRequestBuilder.build(taskConfig, appConfig)
}
