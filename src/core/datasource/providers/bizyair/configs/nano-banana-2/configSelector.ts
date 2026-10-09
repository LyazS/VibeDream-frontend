/**
 * nano-banana-2 配置组选择器
 *
 * 根据是否有参考图片选择变体：
 * - 如果有 ref_images 参数且不为空，使用 default 变种（图片编辑）
 * - 如果没有 ref_images 或为空，使用 t2i 变种（文本生成图片）
 */

import nanoBanana2DefaultConfig from './nano-banana-2.json'
import nanoBanana2T2IConfig from './nano-banana-2-t2i.json'
import type { BizyAirAppConfig } from '../../types'

// 使用对象缓存配置
const configCache: Record<string, BizyAirAppConfig> = {}

// 加载配置到缓存
const defaultConfig: BizyAirAppConfig = nanoBanana2DefaultConfig as BizyAirAppConfig
configCache[defaultConfig.variant] = defaultConfig

const t2iConfig: BizyAirAppConfig = nanoBanana2T2IConfig as BizyAirAppConfig
configCache[t2iConfig.variant] = t2iConfig

export const SELECTOR_ID = 'nano-banana-2'

export function selectConfig(taskConfig: Record<string, unknown>): BizyAirAppConfig {
  /**
   * nano-banana-2 配置组选择器
   *
   * 根据是否有参考图片选择变体：
   * - 如果有 ref_images 参数且不为空，使用 default 变种（图片编辑）
   * - 如果没有 ref_images 或为空，使用 t2i 变种（文本生成图片）
   *
   * @param taskConfig - 任务配置，必须包含 'id' 字段（应为 'nano-banana-2'）
   * @returns BizyAirAppConfig 配置对象
   */
  if (Object.keys(configCache).length === 0) {
    throw new Error('nano-banana-2 配置组没有找到任何JSON配置文件')
  }

  // 检查是否有参考图片
  const refImages = taskConfig['ref_images'] || []
  const hasImages = refImages && Array.isArray(refImages) && refImages.length > 0

  // 根据是否有图片选择变种
  const variant = hasImages ? 'default' : 't2i'

  // 获取对应的配置
  const config = configCache[variant]
  if (!config) {
    throw new Error(`nano-banana-2 配置组未找到变种: ${variant}`)
  }

  return config
}
