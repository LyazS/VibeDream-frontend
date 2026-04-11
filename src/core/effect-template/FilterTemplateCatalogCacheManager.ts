import type {
  FilterTemplateCatalogCache,
  FilterTemplateSummary,
} from '@/core/effect-template/catalogTypes'

const CACHE_KEY = 'filter_template_catalog.global'

export class FilterTemplateCatalogCacheManager {
  static loadCatalog(): FilterTemplateCatalogCache | null {
    try {
      const cacheValue = localStorage.getItem(CACHE_KEY)
      if (!cacheValue) {
        return null
      }

      const parsed = JSON.parse(cacheValue) as FilterTemplateCatalogCache
      if (!parsed || typeof parsed.version !== 'string' || !Array.isArray(parsed.items)) {
        return null
      }

      return parsed
    } catch (error) {
      console.error('[FilterTemplateCatalogCache] 加载缓存失败:', error)
      return null
    }
  }

  static saveCatalog(version: string, items: FilterTemplateSummary[]): void {
    try {
      const payload: FilterTemplateCatalogCache = {
        version,
        timestamp: Date.now(),
        items,
      }
      localStorage.setItem(CACHE_KEY, JSON.stringify(payload))
    } catch (error) {
      console.error('[FilterTemplateCatalogCache] 保存缓存失败:', error)
    }
  }

  static clearCatalog(): void {
    try {
      localStorage.removeItem(CACHE_KEY)
    } catch (error) {
      console.error('[FilterTemplateCatalogCache] 清理缓存失败:', error)
    }
  }
}
