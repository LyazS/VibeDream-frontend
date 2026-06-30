/**
 * read_track 工具实现
 * 读取轨道上的时间轴项目列表，返回 JSON envelope
 */

import { useUnifiedStore } from '@/core/unifiedStore'
import { getTimelineItemsByTrack } from '@/core/utils/timelineSearchUtils'
import { framesToTimecode } from '@/core/utils/timeUtils'
import type { ToolDefinition } from '../core/toolTypes'
import { isValidAgentToolTimecode, parseAgentToolTimecode } from './utils/timecode'
import { buildToolError, buildToolSuccess } from './utils/result'

/**
 * 轨道上的时间轴项目信息
 */
interface TrackItemInfo {
  clipId: string
  mediaId?: string
  start: string
  end: string
  mediaType: string
}

/**
 * read_track 工具执行函数
 *
 * 获取指定轨道上的时间轴项目列表。
 *
 * @param args - 工具参数
 * @param args.trackId - 轨道ID
 * @param args.start - 筛选开始时间（时间码格式），只返回此时间之后的片段
 * @param args.end - 筛选结束时间（时间码格式），只返回此时间之前的片段
 * @returns JSON 格式的轨道项目列表
 */
export async function executeReadTrack(args: Record<string, any>) {
  const { trackId, start, end } = args

  if (!trackId || typeof trackId !== 'string') {
    return buildToolError(
      'read_track',
      'invalid_arguments',
      'trackId 是必填项，且必须是字符串。',
    )
  }

  try {
    const store = useUnifiedStore()
    const track = store.getTrack(trackId)

    if (!track) {
      return buildToolError(
        'read_track',
        'track_not_found',
        `未找到 ID "${trackId}" 的轨道。请使用 list_tracks 查看正确的轨道 ID。`,
        { trackId },
      )
    }

    const allTrackItems = getTimelineItemsByTrack(trackId, store.timelineItems || [])

    let filteredItems = allTrackItems
    if (start || end) {
      if ((start && !isValidAgentToolTimecode(start)) || (end && !isValidAgentToolTimecode(end))) {
        return buildToolError(
          'read_track',
          'invalid_timecode',
          'start 或 end 不是合法的时间码，格式应为 HH:MM:SS+FF。',
          { start, end },
        )
      }

      const startFrames = start ? parseAgentToolTimecode(start) : 0
      const endFrames = end ? parseAgentToolTimecode(end) : Infinity

      filteredItems = allTrackItems.filter((item) => {
        const itemStart = item.timeRange.timelineStartTime
        const itemEnd = item.timeRange.timelineEndTime
        return startFrames < itemEnd && endFrames > itemStart
      })
    }

    const itemInfos: TrackItemInfo[] = filteredItems.map((item) => ({
      clipId: item.id,
      mediaId: item.mediaItemId || undefined,
      start: framesToTimecode(item.timeRange.timelineStartTime),
      end: framesToTimecode(item.timeRange.timelineEndTime),
      mediaType: item.mediaType,
    }))

    const filter =
      start || end
        ? {
            start: start || null,
            end: end || null,
          }
        : undefined

    return buildToolSuccess(
      'read_track',
      {
        trackId: track.id,
        clips: itemInfos,
        total: itemInfos.length,
        filter,
      },
      `${track.id} 上共有 ${itemInfos.length} 个片段。`,
    )
  } catch (error: any) {
    return buildToolError(
      'read_track',
      'internal_error',
      error instanceof Error ? error.message : String(error),
    )
  }
}

/**
 * read_track 工具定义
 * 供 index.ts 注册使用
 */
export const readTrackTool: ToolDefinition = {
  name: 'read_track',
  execute: executeReadTrack
} as ToolDefinition
