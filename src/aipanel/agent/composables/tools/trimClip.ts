import type { MediaType, UnifiedMediaItemData } from '@/core/mediaitem/types'
import type { UnifiedTimelineItemData } from '@/core/timelineitem/model/timelineItem'
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
  clipStartTime?: number
  clipEndTime?: number
  includeSource?: boolean
}) {
  return {
    start: framesToTimecode(params.timelineStartTime),
    end: framesToTimecode(params.timelineEndTime),
    ...(params.includeSource
      ? {
          clipStart: framesToTimecode(params.clipStartTime ?? 0),
          clipEnd: framesToTimecode(params.clipEndTime ?? 0),
        }
      : {}),
  }
}

function isSourceBackedClip(mediaType: MediaType): boolean {
  return mediaType === 'video' || mediaType === 'audio'
}

function buildInvalidRangeError(
  clipId: string,
  side: 'start' | 'end',
  newValue: string,
  message: string,
) {
  return buildToolError('trim_clip', 'invalid_range', message, { clipId, side, newValue })
}

function validateTimelineBoundary(params: {
  clip: UnifiedTimelineItemData<MediaType>
  side: 'start' | 'end'
  targetBoundaryFrame: number
  newValue: string
}) {
  const { clip, side, targetBoundaryFrame, newValue } = params
  const current = clip.timeRange

  if (side === 'start') {
    if (targetBoundaryFrame < 0) {
      return buildInvalidRangeError(clip.id, side, newValue, 'newValue 不能早于时间轴起点 00:00:00+00。')
    }

    if (targetBoundaryFrame >= current.timelineEndTime) {
      return buildInvalidRangeError(clip.id, side, newValue, 'newValue 必须早于当前片段结束时间。')
    }

    return null
  }

  if (targetBoundaryFrame <= current.timelineStartTime) {
    return buildInvalidRangeError(clip.id, side, newValue, 'newValue 必须晚于当前片段开始时间。')
  }

  return null
}

function validateSourceBoundary(params: {
  clip: UnifiedTimelineItemData<MediaType>
  mediaItem?: UnifiedMediaItemData
  side: 'start' | 'end'
  targetBoundaryFrame: number
  newValue: string
}) {
  const { clip, mediaItem, side, targetBoundaryFrame, newValue } = params
  if (!isSourceBackedClip(clip.mediaType)) {
    return null
  }

  const current = clip.timeRange
  const timelineDuration = current.timelineEndTime - current.timelineStartTime
  const sourceDuration = current.clipEndTime - current.clipStartTime
  if (timelineDuration <= 0 || sourceDuration <= 0) {
    return buildInvalidRangeError(clip.id, side, newValue, '当前片段时间范围无效，无法执行 trim。')
  }

  const playbackRate = sourceDuration / timelineDuration
  if (!Number.isFinite(playbackRate) || playbackRate <= 0) {
    return buildInvalidRangeError(clip.id, side, newValue, '当前片段播放倍速无效，无法执行 trim。')
  }

  if (side === 'start') {
    const sourceDelta = Math.round((targetBoundaryFrame - current.timelineStartTime) * playbackRate)
    const nextClipStart = current.clipStartTime + sourceDelta
    if (nextClipStart < 0) {
      return buildInvalidRangeError(
        clip.id,
        side,
        newValue,
        'newValue 超出素材可用范围，开始边界不能再向前扩展。',
      )
    }
    if (nextClipStart >= current.clipEndTime) {
      return buildInvalidRangeError(clip.id, side, newValue, '裁切后素材区间无效。')
    }
    return null
  }

  const sourceDelta = Math.round((targetBoundaryFrame - current.timelineEndTime) * playbackRate)
  const nextClipEnd = current.clipEndTime + sourceDelta
  if (typeof mediaItem?.duration === 'number' && Number.isFinite(mediaItem.duration) && nextClipEnd > mediaItem.duration) {
    return buildInvalidRangeError(
      clip.id,
      side,
      newValue,
      'newValue 超出素材可用范围，结束边界不能再向后扩展。',
    )
  }
  if (nextClipEnd <= current.clipStartTime) {
    return buildInvalidRangeError(clip.id, side, newValue, '裁切后素材区间无效。')
  }

  return null
}

export async function executeTrimClip(args: Record<string, any>) {
  const { clipId, side, newValue } = args

  if (typeof clipId !== 'string' || !clipId) {
    return buildToolError('trim_clip', 'invalid_arguments', 'clipId 是必填字符串。')
  }

  if (side !== 'start' && side !== 'end') {
    return buildToolError('trim_clip', 'invalid_arguments', 'side 必须是 start 或 end。')
  }

  const parsed = parseRequiredTimecode('trim_clip', newValue, 'newValue')
  if (!parsed.ok) {
    return parsed.error
  }

  try {
    const { store, createTrimTimelineItemCommand } = createTimelineCommandHelpers()
    const clip = store.getTimelineItem(clipId)

    if (!clip) {
      return buildToolError(
        'trim_clip',
        'clip_not_found',
        `未找到片段 ${clipId}。请使用 read_tracks 或 read_clip_properties 确认正确 ID。`,
        { clipId },
      )
    }

    const timelineError = validateTimelineBoundary({
      clip,
      side,
      targetBoundaryFrame: parsed.frames,
      newValue,
    })
    if (timelineError) {
      return timelineError
    }

    const mediaItem = clip.mediaItemId ? store.getMediaItem(clip.mediaItemId) : undefined
    const sourceError = validateSourceBoundary({
      clip,
      mediaItem,
      side,
      targetBoundaryFrame: parsed.frames,
      newValue,
    })
    if (sourceError) {
      return sourceError
    }

    const nextTimelineStartTime = side === 'start' ? parsed.frames : clip.timeRange.timelineStartTime
    const nextTimelineEndTime = side === 'end' ? parsed.frames : clip.timeRange.timelineEndTime
    const conflictClipIds: string[] = []
    const firstConflict = findTrackConflict({
      trackId: clip.trackId,
      start: nextTimelineStartTime,
      end: nextTimelineEndTime,
      excludeClipIds: [clipId],
    })
    if (firstConflict) {
      conflictClipIds.push(firstConflict.id)
      for (const item of store.timelineItems) {
        if (item.trackId !== clip.trackId || item.id === clipId || item.id === firstConflict.id) {
          continue
        }
        if (
          Math.max(nextTimelineStartTime, item.timeRange.timelineStartTime) <
          Math.min(nextTimelineEndTime, item.timeRange.timelineEndTime)
        ) {
          conflictClipIds.push(item.id)
        }
      }
    }

    const beforeState = {
      ...buildTrimState({
        timelineStartTime: clip.timeRange.timelineStartTime,
        timelineEndTime: clip.timeRange.timelineEndTime,
        clipStartTime: clip.timeRange.clipStartTime,
        clipEndTime: clip.timeRange.clipEndTime,
        includeSource: isSourceBackedClip(clip.mediaType),
      }),
    }

    await executeSingleCommand(createTrimTimelineItemCommand(clip, side, parsed.frames))

    const afterClip = store.getTimelineItem(clipId)
    if (!afterClip) {
      return buildToolError('trim_clip', 'internal_error', `片段 ${clipId} 裁切后未能重新读取。`)
    }

    return buildToolSuccess(
      'trim_clip',
      {
        clipId,
        side,
        before: beforeState,
        after: buildTrimState({
          timelineStartTime: afterClip.timeRange.timelineStartTime,
          timelineEndTime: afterClip.timeRange.timelineEndTime,
          clipStartTime: afterClip.timeRange.clipStartTime,
          clipEndTime: afterClip.timeRange.clipEndTime,
          includeSource: isSourceBackedClip(afterClip.mediaType),
        }),
        ...(conflictClipIds.length > 0
          ? {
              warning: `已执行，但与同轨片段发生重叠：${conflictClipIds.join(', ')}`,
              overlapClipIds: conflictClipIds,
            }
          : {}),
      },
      conflictClipIds.length > 0
        ? `已调整 ${clipId} 的${side === 'start' ? '开始' : '结束'}边界到 ${parsed.timecode}，但与同轨片段发生重叠。`
        : `已调整 ${clipId} 的${side === 'start' ? '开始' : '结束'}边界到 ${parsed.timecode}。`,
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
