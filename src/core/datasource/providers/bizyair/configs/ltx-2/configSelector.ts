/**
 * ltx-2 配置组选择器
 *
 * 根据是否有参考图片选择变体：
 * - 如果有 ref_images 参数且不为空，使用 i2v 变种（图片转视频）
 * - 如果没有 ref_images 或为空，使用 t2v 变种（文本转视频）
 */

import ltx2I2vConfig from './ltx-2-i2v.json'
import ltx2T2vConfig from './ltx-2-t2v.json'
import type { BizyAirAppConfig } from '../../types'

// 使用对象缓存配置
const configCache: Record<string, BizyAirAppConfig> = {}

// 加载配置到缓存
const i2vConfig: BizyAirAppConfig = ltx2I2vConfig as BizyAirAppConfig
const t2vConfig: BizyAirAppConfig = ltx2T2vConfig as BizyAirAppConfig

configCache[i2vConfig.variant] = i2vConfig
configCache[t2vConfig.variant] = t2vConfig

export const SELECTOR_ID = 'ltx-2'

export function selectConfig(taskConfig: Record<string, unknown>): BizyAirAppConfig {
  /**
   * ltx-2 配置组选择器
   *
   * 根据是否有参考图片选择变体：
   * - 如果有 ref_images 参数且不为空，使用 i2v 变种（图片转视频）
   * - 如果没有 ref_images 或为空，使用 t2v 变种（文本转视频）
   *
   * @param taskConfig - 任务配置，必须包含 'id' 字段（应为 'ltx-2'）
   * @returns BizyAirAppConfig 配置对象
   */
  if (Object.keys(configCache).length === 0) {
    throw new Error('ltx-2 配置组没有找到任何JSON配置文件')
  }

  // 检查是否有参考图片
  const refImages = taskConfig.ref_images || []
  const hasImages =
    (Array.isArray(refImages) || typeof refImages === 'string') && refImages.length > 0

  // 根据是否有图片选择变种
  let variant: string
  if (hasImages) {
    // 有图片输入，使用 i2v 变种（图片转视频）
    variant = 'i2v'
  } else {
    // 无图片输入，使用 t2v 变种（文本转视频）
    variant = 't2v'
  }

  // 获取对应的配置
  if (!(variant in configCache)) {
    throw new Error(`ltx-2 配置组未找到变种: ${variant}`)
  }

  return configCache[variant]
}
