/**
 * 默认配置组的选择器
 * 使用动态导入自动发现所有 JSON 配置文件
 */

import type { BizyAirAppConfig } from '../../types'

/**
 * 动态导入所有 JSON 配置文件
 * Vite 的 import.meta.glob 会自动匹配当前目录下的所有 .json 文件
 */
const configModules = import.meta.glob('./*.json', { eager: true })
type ConfigJsonModule = { default: BizyAirAppConfig }

// 使用对象缓存配置
const configCache: Record<string, Record<string, BizyAirAppConfig>> = {}

// 加载配置到缓存
const configs: BizyAirAppConfig[] = Object.values(configModules).map(
  (module) => (module as ConfigJsonModule).default,
)

for (const loadedConfig of configs) {
  if (!configCache[loadedConfig.id]) {
    configCache[loadedConfig.id] = {}
  }
  configCache[loadedConfig.id][loadedConfig.variant] = loadedConfig
}

export const SELECTOR_ID = 'default'

export function selectConfig(taskConfig: Record<string, any>): BizyAirAppConfig {
  /**
   * 默认配置组的选择器
   *
   * 根据task_config中的variant参数选择配置，如果没有指定则使用第一个配置
   *
   * @param taskConfig - 任务配置，必须包含 'id' 字段，可选包含 'variant' 参数
   * @returns BizyAirAppConfig 配置对象
   */
  const configIds = Object.keys(configCache)
  if (configIds.length === 0) {
    throw new Error('默认配置组没有找到任何JSON配置文件')
  }

  // 验证配置组ID
  const configId = taskConfig['id']
  const configVar = taskConfig['variant']

  const configsForId = configCache[configId]
  if (configsForId) {
    if (configVar) {
      const config = configsForId[configVar]
      if (config) {
        return config
      } else {
        throw new Error(`配置组 '${configId}' 中未找到变体 '${configVar}'`)
      }
    } else {
      // 返回第一个配置作为默认
      const firstKey = Object.keys(configsForId)[0]
      return configsForId[firstKey]
    }
  }

  throw new Error(`未找到配置组ID: ${configId}`)
}
