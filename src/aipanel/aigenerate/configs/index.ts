/**
 * AI 生成配置集合
 * 集中管理所有 AI 生成配置
 * 使用动态导入自动发现所有 JSON 配置文件
 */

import type { AIGenerateConfig } from '../types'

/**
 * 动态导入所有 JSON 配置文件
 * Vite 的 import.meta.glob 会自动匹配所有 .json 文件
 */
const configModules = import.meta.glob('./*.json', { eager: true })
type ConfigJsonModule = { default: AIGenerateConfig }

/**
 * 配置集合
 * 包含所有可用的 AI 生成配置
 * 使用配置文件中的 id 作为键
 */
export const collection: Record<string, AIGenerateConfig> = Object.values(configModules).reduce<Record<string, AIGenerateConfig>>((acc, module) => {
  const config = (module as ConfigJsonModule).default
  acc[config.id] = config
  return acc
}, {})

/**
 * 配置键类型
 */
export type ConfigKey = keyof typeof collection

/**
 * 配置集合类型
 */
export type ConfigCollection = Record<ConfigKey, AIGenerateConfig>

/**
 * 获取指定配置
 * @param key 配置键
 * @returns 配置对象，如果不存在则返回 undefined
 */
export function getConfig(key: string): AIGenerateConfig | undefined {
  return collection[key as ConfigKey]
}

/**
 * 获取所有配置键
 * @returns 配置键数组
 */
export function getConfigKeys(): ConfigKey[] {
  return Object.keys(collection) as ConfigKey[]
}

/**
 * 检查配置是否存在
 * @param key 配置键
 * @returns 是否存在
 */
export function hasConfig(key: string): boolean {
  return key in collection
}
