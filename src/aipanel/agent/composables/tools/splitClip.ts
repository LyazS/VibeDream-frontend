import { framesToTimecode } from '@/core/utils/timeUtils'
import type { ToolDefinition } from '../core/toolTypes'
import { buildToolError, buildToolSuccess } from './utils/result'
import {
  createTimelineCommandHelpers,
  executeSingleCommand,
  parseRequiredTimecode,
} from './timelineEditShared'

export async function executeSplitClip(args: Record<string, any>) {
  const { clipId, splitTimes } = args

  if (typeof clipId !== 'string' || !clipId) {
    return buildToolError('split_clip', 'invalid_arguments', 'clipId 是必填字符串。')
  }

  if (!Array.isArray(splitTimes) || splitTimes.length === 0) {
    return buildToolError('split_clip', 'invalid_arguments', 'splitTimes 必须是非空时间码数组。')
  }

  try {
    const { store, createSplitTimelineItemCommand } = createTimelineCommandHelpers()
    const clip = store.getTimelineItem(clipId)

    if (!clip) {
      return buildToolError(
        'split_clip',
        'clip_not_found',
        `未找到片段 ${clipId}。请使用 read_track 或 read_clip_properties 确认正确 ID。`,
        { clipId },
      )
    }

    const parsedFrames: number[] = []
    for (const splitTime of splitTimes) {
      const parsed = parseRequiredTimecode('split_clip', splitTime, 'splitTimes')
      if (!parsed.ok) {
        return parsed.error
      }
      parsedFrames.push(parsed.frames)
    }

    const uniqueSortedFrames = Array.from(new Set(parsedFrames)).sort((a, b) => a - b)

    for (const frame of uniqueSortedFrames) {
      if (frame <= clip.timeRange.timelineStartTime || frame >= clip.timeRange.timelineEndTime) {
        return buildToolError(
          'split_clip',
          'invalid_split_time',
          `分割点 ${framesToTimecode(frame)} 必须位于片段内部，不能等于边界。`,
          {
            clipId,
            splitTime: framesToTimecode(frame),
          },
        )
      }
    }

    await executeSingleCommand(createSplitTimelineItemCommand(clip, uniqueSortedFrames))

    const segmentBoundaries = [
      clip.timeRange.timelineStartTime,
      ...uniqueSortedFrames,
      clip.timeRange.timelineEndTime,
    ]
    const clips = store.timelineItems
      .filter((item) => item.trackId === clip.trackId)
      .filter((item) =>
        item.timeRange.timelineStartTime >= clip.timeRange.timelineStartTime &&
        item.timeRange.timelineEndTime <= clip.timeRange.timelineEndTime,
      )
      .filter((item) =>
        segmentBoundaries.some((boundary, index) => {
          if (index === segmentBoundaries.length - 1) {
            return false
          }

          const nextBoundary = segmentBoundaries[index + 1]
          return (
            item.timeRange.timelineStartTime === boundary &&
            item.timeRange.timelineEndTime === nextBoundary
          )
        }),
      )
      .sort((a, b) => a.timeRange.timelineStartTime - b.timeRange.timelineStartTime)
      .map((item) => item.id)

    return buildToolSuccess(
      'split_clip',
      {
        originalClipId: clipId,
        splitTimes: uniqueSortedFrames.map((frame) => framesToTimecode(frame)),
        newClipIds: clips,
      },
      `已将 ${clipId} 按 ${uniqueSortedFrames.length} 个时间点切分。`,
    )
  } catch (error: any) {
    return buildToolError(
      'split_clip',
      'internal_error',
      error instanceof Error ? error.message : String(error),
    )
  }
}

export const splitClipTool: ToolDefinition = {
  name: 'split_clip',
  execute: executeSplitClip,
} as ToolDefinition
