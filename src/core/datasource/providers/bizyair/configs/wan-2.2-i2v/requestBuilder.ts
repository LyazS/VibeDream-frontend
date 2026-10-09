/**
 * wan-2.2-i2v 配置组的请求构建器
 *
 * 处理 aspect_ratio 参数，将其转换为 width 和 height。
 * 支持比例：16:9, 9:16, 1:1, 4:3, 3:4, 21:9
 */

import type { BizyAirAppConfig } from '../../types'
import { BizyAirRequestBuilder } from '../../BizyAirRequestBuilder'

// 请求构建器标识符
export const BUILDER_ID = 'wan-2.2-i2v'

// 宽高比映射表
export const ASPECT_RATIO_MAP: Record<string, [number, number]> = {
  '16:9': [960, 540],
  '9:16': [540, 960],
  '1:1': [720, 720],
  '4:3': [960, 720],
  '3:4': [720, 960],
  '21:9': [1260, 540],
}

export function buildRequestData(
  taskConfig: Record<string, unknown>,
  appConfig: BizyAirAppConfig,
): Record<string, unknown> {
  /**
   * wan-2.2-i2v 配置组的请求构建器
   *
   * 处理 aspect_ratio 参数，将其转换为 width 和 height。
   * 其他参数使用通用处理逻辑。
   *
   * @param taskConfig - 用户任务配置（包含 aspect_ratio）
   * @param appConfig - 应用配置
   * @returns 请求数据字典
   */
  // 1. 处理 aspect_ratio 参数，转换为 width 和 height
  const aspectRatio = String(taskConfig['aspect_ratio'] || '16:9')

  let width: number
  let height: number

  if (aspectRatio in ASPECT_RATIO_MAP) {
    ;[width, height] = ASPECT_RATIO_MAP[aspectRatio]
    console.info(`aspect_ratio=${aspectRatio} -> width=${width}, height=${height}`)
  } else {
    console.warn(`未知的 aspect_ratio: ${aspectRatio}，使用默认值 16:9`)
    ;[width, height] = ASPECT_RATIO_MAP['16:9']
  }

  // 2. 将计算出的 width/height 设置到 task_config 中
  const modifiedTaskConfig = { ...taskConfig, width, height }

  // 3. 使用通用构建器处理所有参数
  // （aspect_ratio 标记了 skip_mapping=true，不会被发送到 API）
  return BizyAirRequestBuilder.build(modifiedTaskConfig, appConfig)
}
