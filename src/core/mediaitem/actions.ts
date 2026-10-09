/**
 * 统一媒体项目行为函数
 * 基于"核心数据与行为分离"的响应式重构方案
 */

import type { UnifiedMediaItemData, MediaStatus } from './types'
import { MediaItemQueries } from './queries'

// ==================== 行为函数模块 ====================

// 重新导出查询函数以保持向后兼容性
export { MediaItemQueries as MediaItemQueries } from './queries'

/**
 * 统一媒体项目行为函数 - 无状态操作函数
 */
export const UnifiedMediaItemActions = {
  // 状态转换
  transitionTo(item: UnifiedMediaItemData, newStatus: MediaStatus, _context?: unknown): boolean {
    if (!MediaItemQueries.canTransitionTo(item, newStatus)) {
      console.warn(`无效状态转换: ${item.mediaStatus} → ${newStatus}`)
      return false
    }

    const oldStatus = item.mediaStatus
    item.mediaStatus = newStatus

    console.log(`媒体项目状态转换: ${item.name} ${oldStatus} → ${newStatus}`)

    return true
  },

  // 更新名称
  updateName(item: UnifiedMediaItemData, newName: string): void {
    if (newName.trim()) {
      item.name = newName.trim()
      console.log(`媒体项目名称已更新: ${item.id} -> ${newName}`)
    }
  },

  // 重试
  retry(item: UnifiedMediaItemData): void {
    if (MediaItemQueries.hasAnyError(item)) {
      UnifiedMediaItemActions.transitionTo(item, 'pending')
      // 重置数据源状态
      if (item.source.errorMessage) {
        item.source.progress = 0
        item.source.errorMessage = undefined
      }
    }
  },
}
