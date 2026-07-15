import { cloneDeep } from 'lodash'
import { useUnifiedStore } from '@/core/unifiedStore'

// 调试标记
const DEBUG_CACHE = false
const debugPrefix = '[CONFIG_CACHE]'

// 缓存格式版本
const CACHE_VERSION = '1.0.0'

// 缓存键前缀
const CACHE_KEY_PREFIX = 'ai_config_cache.'

/**
 * 获取当前项目ID
 * 从 unifiedStore 中获取
 */
function getCurrentProjectId(): string {
  try {
    const unifiedStore = useUnifiedStore()
    const projectId = unifiedStore.projectId
    if (projectId) {
      return projectId
    }
  } catch (e) {
    // 如果无法获取 store（例如在非 Vue 组件上下文中），使用默认值
    console.warn('[CONFIG_CACHE] 无法从 unifiedStore 获取项目ID，使用默认值')
  }
  return 'default'
}

/**
 * 缓存数据结构
 */
interface ConfigCacheData {
  version: string
  configId: string
  timestamp: number
  aiConfig: Record<string, any>
}

/**
 * AI配置缓存管理器
 * 负责配置缓存的生命周期管理
 */
export class ConfigCacheManager {
  /**
   * 保存配置到缓存
   * @param configId 配置ID
   * @param aiConfig AI配置对象（带包装器结构）
   */
  static saveConfig(configId: string, aiConfig: Record<string, any>): void {
    try {
      const cacheData: ConfigCacheData = {
        version: CACHE_VERSION,
        configId,
        timestamp: Date.now(),
        aiConfig: cloneDeep(aiConfig), // 深度拷贝避免引用问题
      }

      const cacheKey = this.getCacheKey(configId)
      localStorage.setItem(cacheKey, JSON.stringify(cacheData))

      if (DEBUG_CACHE) {
        console.log(`${debugPrefix} ✅ 保存配置缓存成功:`, {
          cacheKey,
          configId,
          keys: Object.keys(aiConfig),
          dataSize: JSON.stringify(cacheData).length,
          timestamp: new Date(cacheData.timestamp).toLocaleString(),
        })
      }

      // 验证保存是否成功
      const saved = localStorage.getItem(cacheKey)
      if (!saved) {
        console.error(`${debugPrefix} ❌ 保存验证失败: 键不存在`)
      }
    } catch (error) {
      console.error(`${debugPrefix} ❌ 保存配置缓存失败:`, error)
      // 静默失败，不影响用户操作
    }
  }

  /**
   * 从缓存加载配置
   * @param configId 配置ID
   * @returns 缓存的 aiConfig，如果不存在或过期则返回 null
   */
  static loadConfig(configId: string): Record<string, any> | null {
    try {
      const cacheKey = this.getCacheKey(configId)

      if (DEBUG_CACHE) {
        // 列出所有可用的缓存键
        const allKeys = Object.keys(localStorage).filter(k => k.startsWith(CACHE_KEY_PREFIX))
        console.log(`${debugPrefix} 🔍 尝试加载配置:`, {
          targetKey: cacheKey,
          allAvailableKeys: allKeys,
          keyExists: localStorage.getItem(cacheKey) !== null
        })
      }

      const cacheStr = localStorage.getItem(cacheKey)

      if (!cacheStr) {
        if (DEBUG_CACHE) {
          console.log(`${debugPrefix} ⚠️ 缓存未找到: ${configId}`)
        }
        return null
      }

      const cacheData: ConfigCacheData = JSON.parse(cacheStr)

      // 版本检查
      if (cacheData.version !== CACHE_VERSION) {
        console.warn(`${debugPrefix} 缓存版本不匹配，清理旧缓存:`, {
          expected: CACHE_VERSION,
          actual: cacheData.version,
        })
        this.clearConfig(configId)
        return null
      }

      if (DEBUG_CACHE) {
        console.log(`${debugPrefix} ✅ 加载配置缓存成功:`, {
          configId,
          keys: Object.keys(cacheData.aiConfig),
          timestamp: new Date(cacheData.timestamp).toLocaleString(),
        })
      }

      return cacheData.aiConfig
    } catch (error) {
      console.error(`${debugPrefix} ❌ 加载配置缓存失败:`, error)
      return null
    }
  }

  /**
   * 清除指定配置的缓存
   * @param configId 配置ID
   */
  static clearConfig(configId: string): void {
    try {
      const cacheKey = this.getCacheKey(configId)
      localStorage.removeItem(cacheKey)

      if (DEBUG_CACHE) {
        console.log(`${debugPrefix} 清除配置缓存: ${configId}`)
      }
    } catch (error) {
      console.error(`${debugPrefix} 清除配置缓存失败:`, error)
    }
  }

  /**
   * 清除所有配置缓存
   */
  static clearAllConfigs(): void {
    try {
      const keys = Object.keys(localStorage)
      const cacheKeys = keys.filter(key => key.startsWith(CACHE_KEY_PREFIX))

      cacheKeys.forEach(key => {
        localStorage.removeItem(key)
      })

      if (DEBUG_CACHE) {
        console.log(`${debugPrefix} 清除所有配置缓存:`, {
          count: cacheKeys.length,
        })
      }
    } catch (error) {
      console.error(`${debugPrefix} 清除所有配置缓存失败:`, error)
    }
  }

  /**
   * 检查缓存是否存在
   * @param configId 配置ID
   */
  static hasCache(configId: string): boolean {
    const cacheKey = this.getCacheKey(configId)
    return localStorage.getItem(cacheKey) !== null
  }

  /**
   * 生成缓存键名
   * @param configId 配置ID
   */
  private static getCacheKey(configId: string): string {
    const projectId = getCurrentProjectId()
    return `${CACHE_KEY_PREFIX}${projectId}.${configId}`
  }

  /**
   * 获取缓存时间戳
   * @param configId 配置ID
   */
  static getCacheTimestamp(configId: string): number | null {
    try {
      const cacheKey = this.getCacheKey(configId)
      const cacheStr = localStorage.getItem(cacheKey)

      if (!cacheStr) return null

      const cacheData: ConfigCacheData = JSON.parse(cacheStr)
      return cacheData.timestamp
    } catch (error) {
      console.error(`${debugPrefix} 获取缓存时间戳失败:`, error)
      return null
    }
  }

  /**
   * 清理过期缓存（可选功能）
   * @param maxAge 最大缓存时间（毫秒），默认7天
   */
  static clearExpiredCache(maxAge: number = 7 * 24 * 60 * 60 * 1000): void {
    try {
      const now = Date.now()
      const keys = Object.keys(localStorage)
      const cacheKeys = keys.filter(key => key.startsWith(CACHE_KEY_PREFIX))

      let clearedCount = 0

      cacheKeys.forEach(key => {
        const cacheStr = localStorage.getItem(key)
        if (!cacheStr) return

        try {
          const cacheData: ConfigCacheData = JSON.parse(cacheStr)
          const age = now - cacheData.timestamp

          if (age > maxAge) {
            localStorage.removeItem(key)
            clearedCount++
          }
        } catch (error) {
          // 解析失败，删除该缓存
          localStorage.removeItem(key)
          clearedCount++
        }
      })

      if (DEBUG_CACHE && clearedCount > 0) {
        console.log(`${debugPrefix} 清理过期缓存:`, {
          count: clearedCount,
          maxAge: `${maxAge / (24 * 60 * 60 * 1000)}天`,
        })
      }
    } catch (error) {
      console.error(`${debugPrefix} 清理过期缓存失败:`, error)
    }
  }
}

// 导出便捷函数
export const saveAiConfigCache = ConfigCacheManager.saveConfig.bind(ConfigCacheManager)
export const loadAiConfigCache = ConfigCacheManager.loadConfig.bind(ConfigCacheManager)
export const clearAiConfigCache = ConfigCacheManager.clearConfig.bind(ConfigCacheManager)
export const clearAllAiConfigCache = ConfigCacheManager.clearAllConfigs.bind(ConfigCacheManager)
