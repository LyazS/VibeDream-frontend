/**
 * 轨道相关常量定义
 */

import type { UnifiedTrackType } from '@/core/track/TrackTypes'

/**
 * 默认轨道名称映射
 */
export const DEFAULT_TRACK_NAMES: Record<UnifiedTrackType, string> = {
  video: '默认视频轨道',
  audio: '默认音频轨道',
}

/**
 * 默认轨道高度映射
 * 视频轨道: 70px, 音频轨道: 60px
 */
export const DEFAULT_TRACK_HEIGHTS: Record<UnifiedTrackType, number> = {
  video: 70,
  audio: 60,
}

/**
 * 默认轨道内间距
 * 轨道高度60px，clip高度50px（60px - 5px * 2），上下各留5px间距
 */
export const DEFAULT_TRACK_PADDING = 5
