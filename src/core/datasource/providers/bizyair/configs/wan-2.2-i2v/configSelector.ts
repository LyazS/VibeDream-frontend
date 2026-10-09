/**
 * wan-2.2-i2v 配置组选择器
 *
 * 支持三个变种：
 * - official: 官方模型 + 4步 LoRA
 * - smoothv1: Smooth v1
 * - smoothv2: Smooth v2（默认）
 */

import wan22i2vOfficialConfig from './wan-2.2-i2v-official.json'
import wan22i2vSmoothv1Config from './wan-2.2-i2v-smoothv1.json'
import wan22i2vSmoothv2Config from './wan-2.2-i2v-smoothv2.json'
import type { BizyAirAppConfig } from '../../types'

// 使用对象缓存配置
const configCache: Record<string, BizyAirAppConfig> = {}

// 加载配置到缓存
const configs: BizyAirAppConfig[] = [
  wan22i2vOfficialConfig as BizyAirAppConfig,
  wan22i2vSmoothv1Config as BizyAirAppConfig,
  wan22i2vSmoothv2Config as BizyAirAppConfig,
]

for (const config of configs) {
  configCache[config.variant] = config
}

export const SELECTOR_ID = 'wan-2.2-i2v'

export function selectConfig(taskConfig: Record<string, unknown>): BizyAirAppConfig {
  /**
   * wan-2.2-i2v 配置组选择器
   *
   * 根据任务配置中的 variant 参数选择变种：
   * - 如果指定了 variant 参数且值有效，使用对应的变种
   * - 如果没有指定或值无效，使用默认的 smoothv2 变种
   *
   * @param taskConfig - 任务配置，必须包含 'id' 字段（应为 'wan-2.2-i2v'）
   *                     可选包含 'variant' 字段（'official', 'smoothv1', 'smoothv2'）
   * @returns BizyAirAppConfig 配置对象
   */
  const variants = Object.keys(configCache)
  if (variants.length === 0) {
    throw new Error('wan-2.2-i2v 配置组没有找到任何JSON配置文件')
  }

  // 获取 variant 参数，默认使用 smoothv2
  const variant = taskConfig['variant'] || 'smoothv2'

  // 验证 variant 是否有效
  const validVariants = ['official', 'smoothv1', 'smoothv2']
  if (typeof variant !== 'string' || !validVariants.includes(variant)) {
    console.warn(`无效的 variant 值: ${variant}，使用默认值 smoothv2`)
    const fallbackVariant = 'smoothv2'
    if (!(fallbackVariant in configCache)) {
      throw new Error(`wan-2.2-i2v 配置组未找到变种: ${fallbackVariant}`)
    }
    return configCache[fallbackVariant]
  }

  // 获取对应的配置
  if (!(variant in configCache)) {
    throw new Error(`wan-2.2-i2v 配置组未找到变种: ${variant}`)
  }

  return configCache[variant]
}
