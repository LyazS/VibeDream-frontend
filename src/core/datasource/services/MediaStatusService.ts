/**
 * 媒体状态管理器
 * 专门负责媒体项目的状态转换逻辑
 */

import type { UnifiedMediaItemData, MediaStatus } from '@/core/mediaitem/types'

/**
 * 媒体状态管理器
 * 负责统一管理媒体项目的状态转换
 */
export class MediaStatusManager {
  /**
   * 转换媒体项目状态
   * @param mediaItem 媒体项目
   * @param newStatus 新状态
   * @param context 上下文信息（可选）
   * @returns 是否转换成功
   */
  transitionTo(
    mediaItem: UnifiedMediaItemData,
    newStatus: MediaStatus,
    context?: unknown,
  ): boolean {
    if (!this.validateTransition(mediaItem.mediaStatus, newStatus)) {
      console.warn(
        `⚠️ [MediaStatusManager] 无效状态转换: ${mediaItem.name} ${mediaItem.mediaStatus} → ${newStatus}`,
      )
      return false
    }

    const oldStatus = mediaItem.mediaStatus
    mediaItem.mediaStatus = newStatus

    console.log(
      `🔄 [MediaStatusManager] 媒体状态转换: ${mediaItem.name} ${oldStatus} → ${newStatus}`,
    )

    if (context) {
      console.log(`📝 [MediaStatusManager] 转换上下文:`, context)
    }

    return true
  }

  /**
   * 验证状态转换是否合法
   * @param fromStatus 源状态
   * @param toStatus 目标状态
   * @returns 是否允许转换
   */
  validateTransition(fromStatus: MediaStatus, toStatus: MediaStatus): boolean {
    const validTransitions: Record<MediaStatus, MediaStatus[]> = {
      pending: ['asyncprocessing', 'error', 'cancelled'],
      asyncprocessing: ['decoding', 'error', 'cancelled'],
      decoding: ['ready', 'error', 'cancelled'],
      ready: ['error'],
      error: ['pending', 'cancelled'],
      cancelled: ['pending'],
      missing: ['pending', 'cancelled'],
    }

    return validTransitions[fromStatus]?.includes(toStatus) || false
  }

  /**
   * 检查是否可以转换到指定状态
   * @param mediaItem 媒体项目
   * @param newStatus 新状态
   * @returns 是否可以转换
   */
  canTransitionTo(mediaItem: UnifiedMediaItemData, newStatus: MediaStatus): boolean {
    return this.validateTransition(mediaItem.mediaStatus, newStatus)
  }

  /**
   * 获取当前状态的允许转换列表
   * @param currentStatus 当前状态
   * @returns 允许转换的状态列表
   */
  getAllowedTransitions(currentStatus: MediaStatus): MediaStatus[] {
    const validTransitions: Record<MediaStatus, MediaStatus[]> = {
      pending: ['asyncprocessing', 'error', 'cancelled'],
      asyncprocessing: ['decoding', 'error', 'cancelled'],
      decoding: ['ready', 'error', 'cancelled'],
      ready: ['error'],
      error: ['pending', 'cancelled'],
      cancelled: ['pending'],
      missing: ['pending', 'cancelled'],
    }

    return validTransitions[currentStatus] || []
  }

  /**
   * 重置媒体项目状态
   * @param mediaItem 媒体项目
   * @param targetStatus 目标状态（默认为pending）
   * @returns 是否重置成功
   */
  resetStatus(mediaItem: UnifiedMediaItemData, targetStatus: MediaStatus = 'pending'): boolean {
    // 只有错误状态、取消状态或缺失状态才能重置
    const resettableStatuses: MediaStatus[] = ['error', 'cancelled', 'missing']

    if (!resettableStatuses.includes(mediaItem.mediaStatus)) {
      console.warn(
        `⚠️ [MediaStatusManager] 无法重置状态: ${mediaItem.name} 当前状态 ${mediaItem.mediaStatus} 不允许重置`,
      )
      return false
    }

    return this.transitionTo(mediaItem, targetStatus, { action: 'reset' })
  }

  /**
   * 获取状态统计信息
   * @param mediaItems 媒体项目列表
   * @returns 状态统计
   */
  getStatusStats(mediaItems: UnifiedMediaItemData[]): Record<MediaStatus, number> {
    const stats: Record<MediaStatus, number> = {
      pending: 0,
      asyncprocessing: 0,
      decoding: 0,
      ready: 0,
      error: 0,
      cancelled: 0,
      missing: 0,
    }

    for (const mediaItem of mediaItems) {
      stats[mediaItem.mediaStatus]++
    }

    return stats
  }
}
