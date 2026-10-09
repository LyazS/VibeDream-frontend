/**
 * qwen-image-edit-2512 配置组的请求构建器
 *
 * 此配置组目前使用默认的请求构建逻辑。
 * 如果将来需要特殊的处理逻辑（如图片预处理、参数转换等），
 * 可以在此文件中实现自定义的 buildRequestData 函数。
 */

import type { BizyAirAppConfig } from '../../types'
import { BizyAirRequestBuilder } from '../../BizyAirRequestBuilder'

// 请求构建器标识符
export const BUILDER_ID = 'qwen-image-edit-2512'

export function buildRequestData(
  taskConfig: Record<string, unknown>,
  appConfig: BizyAirAppConfig,
): Record<string, unknown> {
  /**
   * qwen-image-edit-2512 请求构建器
   *
   * 当前实现：直接使用默认构建器。
   *
   * 如果需要自定义逻辑，可以在此处实现，例如：
   * - 图片预处理
   * - 参数转换
   * - 条件逻辑等
   *
   * @param taskConfig - 用户任务配置
   * @param appConfig - 应用配置
   * @returns 请求数据字典
   */
  // 直接使用默认构建器
  return BizyAirRequestBuilder.build(taskConfig, appConfig)
}
