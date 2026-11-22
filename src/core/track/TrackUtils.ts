/**
 * 轨道工具函数集合
 */

import { DEFAULT_TRACK_NAMES, DEFAULT_TRACK_HEIGHTS } from '@/constants/TrackConstants'
import type { MediaType } from '@/core/mediaitem'
import type { UnifiedTrackType } from './TrackTypes'

/**
 * 获取默认轨道名称
 */
export function getDefaultTrackName(type: UnifiedTrackType): string {
  return DEFAULT_TRACK_NAMES[type]
}

/**
 * 获取默认轨道高度
 */
export function getDefaultTrackHeight(type: UnifiedTrackType): number {
  return DEFAULT_TRACK_HEIGHTS[type]
}

/**
 * 将媒体类型映射到轨道类型
 */
export function mapMediaTypeToTrackType(mediaType: MediaType): UnifiedTrackType {
  switch (mediaType) {
    case 'video':
    case 'image':
      return 'video'
    case 'audio':
      return 'audio'
    default:
      return 'video' // 默认视频轨道
  }
}
