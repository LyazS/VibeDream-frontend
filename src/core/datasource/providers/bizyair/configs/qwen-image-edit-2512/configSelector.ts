/**
 * qwen-image-edit-2512 配置组选择器
 *
 * 根据参考图片数量选择合适的配置变种。
 */

import config1Image from './qwen-image-edit-2512-1image.json'
import config2Image from './qwen-image-edit-2512-2image.json'
import config3Image from './qwen-image-edit-2512-3image.json'
import type { BizyAirAppConfig } from '../../types'

// 缓存配置按variant名称索引
const configVariant: Record<string, BizyAirAppConfig> = {}

// 加载所有JSON配置到缓存
const configs: BizyAirAppConfig[] = [
  config1Image as BizyAirAppConfig,
  config2Image as BizyAirAppConfig,
  config3Image as BizyAirAppConfig,
]

for (const config of configs) {
  configVariant[config.variant] = config
}

export const SELECTOR_ID = 'qwen-image-edit-2512'

export function selectConfig(taskConfig: Record<string, unknown>): BizyAirAppConfig {
  /**
   * qwen-image-edit-2512 配置组选择器
   *
   * 根据参考图片数量选择合适的配置变种：
   * - 1张参考图片: 使用 qwen-image-edit-2512-1image
   * - 2张参考图片: 使用 qwen-image-edit-2512-2image
   * - 3张参考图片: 使用 qwen-image-edit-2512-3image
   *
   * @param taskConfig - 任务配置，必须包含 'id' 字段（应为 'qwen-image-edit-2512'）
   * @returns BizyAirAppConfig 配置对象
   */
  // 验证配置组ID
  const configId = taskConfig['id']
  if (configId !== SELECTOR_ID) {
    throw new Error(`不支持的配置组ID: ${configId}`)
  }

  // 获取参考图片数量
  const refImages = taskConfig['ref_images'] || []
  const refCount = Array.isArray(refImages) || typeof refImages === 'string' ? refImages.length : 0

  // 根据参考图片数量选择变种
  let variant: string
  if (refCount === 1) {
    variant = '1image'
  } else if (refCount === 2) {
    variant = '2image'
  } else if (refCount === 3) {
    variant = '3image'
  } else {
    throw new Error(`不支持的参考图片数量: ${refCount}。仅支持1-3张参考图片。`)
  }

  // 从内存缓存获取配置
  const config = configVariant[variant]
  if (!config) {
    throw new Error(`配置变种不存在: ${variant}`)
  }

  return config
}
