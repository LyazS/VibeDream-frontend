import { framesToTimecode } from '@/core/utils/timeUtils'
import type { ToolDefinition } from '../core/toolTypes'
import { buildToolError, buildToolSuccess } from './utils/result'
import {
  createTimelineCommandHelpers,
  executeSingleCommand,
  findTrackConflict,
  parseRequiredTimecode,
} from './timelineEditShared'

function buildTrimState(params: {
  timelineStartTime: number
  timelineEndTime: number
}) {
  return {
    startTime: framesToTimecode(params.timelineStartTime),
    endTime: framesToTimecode(params.timelineEndTime),
  }
}

export async function executeTrimClip(args: Record<string, any>) {
  const { clipId, side, newTime } = args

  if (typeof clipId !== 'string' || !clipId) {
    return buildToolError('trim_clip', 'invalid_arguments', 'clipId 是必填字符串。')
  }

  if (side !== 'start' && side !== 'end') {
    return buildToolError('trim_clip', 'invalid_arguments', 'side 必须是 start 或 end。')
  }

  const parsed = parseRequiredTimecode('trim_clip', newTime, 'newTime')
  if (!parsed.ok) {
    return parsed.error
  }

  try {
    const { store, createResizeTimelineItemCommand } = createTimelineCommandHelpers()
    const clip = store.getTimelineItem(clipId)

    if (!clip) {
      return buildToolError(
        'trim_clip',
        'clip_not_found',
        `未找到片段 ${clipId}。请使用 read_track 或 read_clip 确认正确 ID。`,
        { clipId },
      )
    }

    const beforeTimelineStartTime = clip.timeRange.timelineStartTime
    const beforeTimelineEndTime = clip.timeRange.timelineEndTime
    const nextTimeRange = { ...clip.timeRange }

    if (side === 'start') {
      if (parsed.frames <= clip.timeRange.timelineStartTime || parsed.frames >= clip.timeRange.timelineEndTime) {
        return buildToolError(
          'trim_clip',
          'invalid_range',
          'newTime 必须位于当前片段内部，且不能等于或超过结束时间。',
          { clipId, side, newTime },
        )
      }

      const delta = parsed.frames - clip.timeRange.timelineStartTime
      nextTimeRange.timelineStartTime = parsed.frames
      nextTimeRange.clipStartTime = clip.timeRange.clipStartTime + delta
    } else {
      if (parsed.frames >= clip.timeRange.timelineEndTime || parsed.frames <= clip.timeRange.timelineStartTime) {
        return buildToolError(
          'trim_clip',
          'invalid_range',
          'newTime 必须位于当前片段内部，且不能等于或早于开始时间。',
          { clipId, side, newTime },
        )
      }

      const delta = clip.timeRange.timelineEndTime - parsed.frames
      nextTimeRange.timelineEndTime = parsed.frames
      nextTimeRange.clipEndTime = clip.timeRange.clipEndTime - delta
    }

    if (nextTimeRange.clipStartTime >= nextTimeRange.clipEndTime) {
      return buildToolError('trim_clip', 'invalid_range', '裁切后素材区间无效。', { clipId, side, newTime })
    }

    const conflict = findTrackConflict({
      trackId: clip.trackId,
      start: nextTimeRange.timelineStartTime,
      end: nextTimeRange.timelineEndTime,
      excludeClipIds: [clipId],
    })
    if (conflict) {
      return buildToolError(
        'trim_clip',
        'timeline_conflict',
        `裁切后的区间与现有片段 ${conflict.id} 冲突，已拒绝执行。`,
        { clipId, conflictClipId: conflict.id },
      )
    }

    await executeSingleCommand(createResizeTimelineItemCommand(clip, nextTimeRange))

    const afterClip = store.getTimelineItem(clipId)
    if (!afterClip) {
      return buildToolError('trim_clip', 'internal_error', `片段 ${clipId} 裁切后未能重新读取。`)
    }

    return buildToolSuccess(
      'trim_clip',
      {
        clipId,
        side,
        before: buildTrimState({
          timelineStartTime: beforeTimelineStartTime,
          timelineEndTime: beforeTimelineEndTime,
        }),
        after: buildTrimState({
          timelineStartTime: afterClip.timeRange.timelineStartTime,
          timelineEndTime: afterClip.timeRange.timelineEndTime,
        }),
      },
      `已调整 ${clipId} 的${side === 'start' ? '开始' : '结束'}边界到 ${parsed.timecode}。`,
    )
  } catch (error: any) {
    return buildToolError(
      'trim_clip',
      'internal_error',
      error instanceof Error ? error.message : String(error),
    )
  }
}

export const trimClipTool: ToolDefinition = {
  name: 'trim_clip',
  execute: executeTrimClip,
} as ToolDefinition
