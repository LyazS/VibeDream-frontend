/**
 * list_tracks 工具实现
 * 列出时间轴上所有轨道的基本信息，返回 JSON envelope
 */

import { useUnifiedStore } from '@/core/unifiedStore'
import { getTimelineItemsByTrack } from '@/core/utils/timelineSearchUtils'
import type { ToolDefinition } from './types'
import { buildToolError, buildToolSuccess } from './utils/result'

/**
 * list_tracks 工具执行函数
 *
 * 获取时间轴上所有轨道的基本信息（id、名字、类型），用于快速浏览和筛选轨道。
 *
 * @returns JSON 格式的轨道基本信息
 */
export async function executeListTracks(args: Record<string, unknown>) {
  try {
    void args
    const store = useUnifiedStore()
    const tracks = store.tracks || []
    const timelineItems = store.timelineItems || []

    if (tracks.length === 0) {
      return buildToolSuccess('list_tracks', {
        tracks: [],
        total: 0,
      })
    }

    const trackInfos = tracks.map((track, index) => ({
      trackId: track.id,
      name: track.name,
      type: track.type as 'video' | 'audio' | 'text',
      index,
      visible: track.isVisible,
      muted: track.isMuted,
      clipCount: getTimelineItemsByTrack(track.id, timelineItems).length,
    }))

    return buildToolSuccess('list_tracks', {
      tracks: trackInfos,
      total: trackInfos.length,
    })
  } catch (error) {
    return buildToolError(
      'list_tracks',
      'internal_error',
      error instanceof Error ? error.message : String(error),
    )
  }
}

/**
 * list_tracks 工具定义
 * 供 index.ts 注册使用
 */
export const listTracksTool: ToolDefinition = {
  name: 'list_tracks',
  execute: executeListTracks,
} as ToolDefinition
