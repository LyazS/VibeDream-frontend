/**
 * read_tracks 工具实现
 * 批量读取轨道上的时间轴项目列表，返回 JSON envelope
 */

import { useUnifiedStore } from '@/core/unifiedStore'
import { getTimelineItemsByTrack } from '@/core/utils/timelineSearchUtils'
import { framesToTimecode } from '@/core/utils/timeUtils'
import type { ToolDefinition } from '../core/toolTypes'
import { isValidAgentToolTimecode, parseAgentToolTimecode } from './utils/timecode'
import { buildToolError, buildToolSuccess } from './utils/result'
import { getTransitionSnapshot } from './transitionItemShared'

const MAX_TRACK_IDS = 10

interface ReadTracksSuccessEntry {
  trackId: string
  items: Array<Record<string, unknown>>
  total: number
}

interface ReadTracksFailureEntry {
  trackId: string
  error: string
}

type ReadTracksEntry = ReadTracksSuccessEntry | ReadTracksFailureEntry

class ReadTracksValidationError extends Error {}

function normalizeTrackIds(trackIds: unknown): {
  requestedTotal: number
  normalizedTrackIds: string[]
} {
  if (!Array.isArray(trackIds) || trackIds.length === 0) {
    throw new ReadTracksValidationError('trackIds 是必填项，且必须是非空数组。')
  }

  if (trackIds.length > MAX_TRACK_IDS) {
    throw new ReadTracksValidationError(`trackIds 最多只能包含 ${MAX_TRACK_IDS} 个轨道 ID。`)
  }

  const normalized: string[] = []
  const seen = new Set<string>()

  for (const trackId of trackIds) {
    const normalizedTrackId = typeof trackId === 'string' ? trackId.trim() : ''
    if (!normalizedTrackId) {
      throw new ReadTracksValidationError('trackIds 只能包含非空字符串。')
    }
    if (seen.has(normalizedTrackId)) {
      continue
    }
    seen.add(normalizedTrackId)
    normalized.push(normalizedTrackId)
  }

  return {
    requestedTotal: trackIds.length,
    normalizedTrackIds: normalized,
  }
}

/**
 * read_tracks 工具执行函数
 *
 * 获取一个或多个指定轨道上的时间轴项目列表。
 *
 * @param args - 工具参数
 * @param args.trackIds - 轨道ID数组
 * @param args.start - 共享筛选开始时间（时间码格式）
 * @param args.end - 共享筛选结束时间（时间码格式）
 * @returns JSON 格式的轨道项目列表
 */
export async function executeReadTracks(args: Record<string, any>) {
  const { trackIds, start, end } = args

  try {
    const { requestedTotal, normalizedTrackIds } = normalizeTrackIds(trackIds)

    if ((start && !isValidAgentToolTimecode(start)) || (end && !isValidAgentToolTimecode(end))) {
      return buildToolError(
        'read_tracks',
        'invalid_timecode',
        'start 或 end 不是合法的时间码，格式应为 HH:MM:SS+FF。',
        { start, end },
      )
    }

    const startFrames = start ? parseAgentToolTimecode(start) : 0
    const endFrames = end ? parseAgentToolTimecode(end) : Infinity

    if (startFrames > endFrames) {
      return buildToolError(
        'read_tracks',
        'invalid_time_range',
        'start 不能晚于 end。',
        { start, end },
      )
    }

    const store = useUnifiedStore()
    const timelineItems = store.timelineItems || []

    const tracks: ReadTracksEntry[] = normalizedTrackIds.map((trackId) => {
      const track = store.getTrack(trackId)
      if (!track) {
        return {
          trackId,
          error: `未找到 ID "${trackId}" 的轨道。请使用 list_tracks 查看正确的轨道 ID。`,
        }
      }

      const filteredItems = getTimelineItemsByTrack(trackId, timelineItems)
        .filter((item) => {
          const itemStart = item.timeRange.timelineStartTime
          const itemEnd = item.timeRange.timelineEndTime
          // Overlap match: any clip intersecting the filter window should be included.
          return startFrames < itemEnd && endFrames > itemStart
        })
        .sort((left, right) => left.timeRange.timelineStartTime - right.timeRange.timelineStartTime)

      const clips = filteredItems.map((item) => ({
        item: {
          itemId: item.id,
          itemType: 'clip' as const,
          mediaId: item.mediaItemId || undefined,
          start: framesToTimecode(item.timeRange.timelineStartTime),
          end: framesToTimecode(item.timeRange.timelineEndTime),
          mediaType: item.mediaType,
        },
        sortFrame: item.timeRange.timelineStartTime,
        // A transition at a seam is listed before the right clip at the same frame.
        sortOrder: 1,
      }))

      const transitions = getTimelineItemsByTrack(trackId, timelineItems)
        .flatMap((item) => {
          const transition = getTransitionSnapshot(item)
          if (!transition) return []
          const intersects = transition.startFrame !== null && transition.endFrame !== null
            ? startFrames < transition.endFrame && endFrames > transition.startFrame
            : startFrames <= transition.seamFrame && endFrames >= transition.seamFrame
          return intersects ? [{
            item: {
              itemId: transition.itemId,
              itemType: 'transition' as const,
              leftClipId: transition.leftClipId,
              ...(transition.rightClipId ? { rightClipId: transition.rightClipId } : {}),
              ...(transition.startFrame !== null && transition.endFrame !== null
                ? {
                    start: framesToTimecode(transition.startFrame),
                    end: framesToTimecode(transition.endFrame),
                  }
                : {}),
            },
            // Keep this internal seam frame even when seamTime is intentionally omitted.
            sortFrame: transition.seamFrame,
            sortOrder: 0,
          }] : []
        })
      const items = [
        ...clips,
        ...transitions,
      ].sort((left, right) => left.sortFrame - right.sortFrame || left.sortOrder - right.sortOrder)
        .map((entry) => entry.item)
      return {
        trackId: track.id,
        items,
        total: items.length,
      }
    })

    const failedTotal = tracks.filter((track) => 'error' in track).length
    const filter =
      start || end
        ? {
            start: start || null,
            end: end || null,
          }
        : undefined

    return buildToolSuccess('read_tracks', {
      tracks,
      requestedTotal,
      total: normalizedTrackIds.length,
      failedTotal,
      filter,
    })
  } catch (error: any) {
    return buildToolError(
      'read_tracks',
      error instanceof ReadTracksValidationError ? 'invalid_arguments' : 'internal_error',
      error instanceof Error ? error.message : String(error),
    )
  }
}

/**
 * read_tracks 工具定义
 * 供 index.ts 注册使用
 */
export const readTracksTool: ToolDefinition = {
  name: 'read_tracks',
  execute: executeReadTracks
} as ToolDefinition
