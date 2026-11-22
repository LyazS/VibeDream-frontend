/**
 * 统一媒体项目查询函数
 * 基于"核心数据与行为分离"的响应式重构方案
 */

import type {
  UnifiedMediaItemData,
  MediaStatus,
  PendingMediaItem,
  ReadyMediaItem,
  ProcessingMediaItem,
  ErrorMediaItem,
  VideoMediaItem,
  ImageMediaItem,
  AudioMediaItem,
  UnknownMediaItem,
  KnownMediaItem,
  VisualMediaItem,
  AudioCapableMediaItem,
} from './types'

/**
 * 统一媒体项目查询函数 - 无状态查询函数
 */
export const MediaItemQueries = {
  // 状态检查
  isPending(item: UnifiedMediaItemData): item is PendingMediaItem {
    return item.mediaStatus === 'pending'
  },

  isReady(item: UnifiedMediaItemData): item is ReadyMediaItem {
    return item.mediaStatus === 'ready' && !!item.duration
  },

  isProcessing(item: UnifiedMediaItemData): item is ProcessingMediaItem {
    return item.mediaStatus === 'asyncprocessing' || item.mediaStatus === 'decoding'
  },

  hasError(item: UnifiedMediaItemData): item is ErrorMediaItem & { mediaStatus: 'error' } {
    return item.mediaStatus === 'error'
  },

  hasAnyError(item: UnifiedMediaItemData): item is ErrorMediaItem {
    return (
      item.mediaStatus === 'error' ||
      item.mediaStatus === 'cancelled' ||
      item.mediaStatus === 'missing'
    )
  },

  isParsing(item: UnifiedMediaItemData): boolean {
    return MediaItemQueries.isPending(item) || MediaItemQueries.isProcessing(item)
  },

  // 状态转换验证
  canTransitionTo(item: UnifiedMediaItemData, newStatus: MediaStatus): boolean {
    const validTransitions: Record<MediaStatus, MediaStatus[]> = {
      pending: ['asyncprocessing', 'error', 'cancelled'],
      asyncprocessing: ['decoding', 'error', 'cancelled'],
      decoding: ['ready', 'error', 'cancelled'],
      ready: ['error'],
      error: ['pending', 'cancelled'],
      cancelled: ['pending'],
      missing: ['pending', 'cancelled'],
    }

    return validTransitions[item.mediaStatus]?.includes(newStatus) || false
  },

  // 获取原始尺寸
  getOriginalSize(item: UnifiedMediaItemData): { width: number; height: number } | undefined {
    if (item.runtime.bunny?.originalWidth && item.runtime.bunny?.originalHeight) {
      return {
        width: item.runtime.bunny.originalWidth,
        height: item.runtime.bunny.originalHeight,
      }
    }
    return undefined
  },

  // 媒体类型判断 - 类型守卫函数
  isVideo(item: UnifiedMediaItemData): item is VideoMediaItem {
    return item.mediaType === 'video'
  },

  isImage(item: UnifiedMediaItemData): item is ImageMediaItem {
    return item.mediaType === 'image'
  },

  isAudio(item: UnifiedMediaItemData): item is AudioMediaItem {
    return item.mediaType === 'audio'
  },

  isUnknownType(item: UnifiedMediaItemData): item is UnknownMediaItem {
    return item.mediaType === 'unknown'
  },

  // 媒体类型分组判断
  isVisualMedia(item: UnifiedMediaItemData): item is VisualMediaItem {
    return item.mediaType === 'video' || item.mediaType === 'image'
  },

  isAudioCapableMedia(item: UnifiedMediaItemData): item is AudioCapableMediaItem {
    return item.mediaType === 'audio' || item.mediaType === 'video'
  },

  hasKnownType(item: UnifiedMediaItemData): item is KnownMediaItem {
    return item.mediaType !== 'unknown'
  },
}
