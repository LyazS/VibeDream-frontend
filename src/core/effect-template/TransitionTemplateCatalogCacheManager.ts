import type {
  TransitionTemplateCatalogCache,
  TransitionTemplateSummary,
} from '@/core/effect-template/catalogTypes'

const CACHE_KEY = 'transition_template_catalog.global'

export class TransitionTemplateCatalogCacheManager {
  static loadCatalog(): TransitionTemplateCatalogCache | null {
    try {
      const cacheValue = localStorage.getItem(CACHE_KEY)
      if (!cacheValue) {
        return null
      }

      const parsed = JSON.parse(cacheValue) as TransitionTemplateCatalogCache
      if (!parsed || typeof parsed.version !== 'string' || !Array.isArray(parsed.items)) {
        return null
      }

      return parsed
    } catch (error) {
      console.error('[TransitionTemplateCatalogCache] 加载缓存失败:', error)
      return null
    }
  }

  static saveCatalog(version: string, items: TransitionTemplateSummary[]): void {
    try {
      const payload: TransitionTemplateCatalogCache = {
        version,
        timestamp: Date.now(),
        items,
      }
      localStorage.setItem(CACHE_KEY, JSON.stringify(payload))
    } catch (error) {
      console.error('[TransitionTemplateCatalogCache] 保存缓存失败:', error)
    }
  }

  static clearCatalog(): void {
    try {
      localStorage.removeItem(CACHE_KEY)
    } catch (error) {
      console.error('[TransitionTemplateCatalogCache] 清理缓存失败:', error)
    }
  }
}
