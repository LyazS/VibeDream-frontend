import { framesToTimecode } from '@/core/utils/timeUtils'
import type { ToolDefinition } from '../core/toolTypes'
import { buildToolError, buildToolSuccess } from './utils/result'
import {
  createTimelineCommandHelpers,
  executeSingleCommand,
  findTrackConflict,
  getExpectedTrackTypeForMedia,
  parseRequiredTimecode,
  validateTrackCompatibility,
} from './timelineEditShared'

function buildMoveState(params: {
  trackId: string
  startFrames: number
  includeTrackId: boolean
  includeStart: boolean
}) {
  return {
    ...(params.includeTrackId ? { trackId: params.trackId } : {}),
    ...(params.includeStart ? { start: framesToTimecode(params.startFrames) } : {}),
  }
}

export async function executeMoveClip(args: Record<string, any>) {
  const { clipId, start, trackId } = args

  if (typeof clipId !== 'string' || !clipId) {
    return buildToolError('move_clip', 'invalid_arguments', 'clipId 是必填字符串。')
  }

  if (!start || typeof start !== 'object' || Array.isArray(start)) {
    return buildToolError(
      'move_clip',
      'invalid_arguments',
      'start 是必填对象，且必须包含 from 和 to。',
    )
  }

  const startFromParsed = parseRequiredTimecode('move_clip', start.from, 'start.from')
  if (!startFromParsed.ok) {
    return startFromParsed.error
  }

  const startToParsed = parseRequiredTimecode('move_clip', start.to, 'start.to')
  if (!startToParsed.ok) {
    return startToParsed.error
  }

  let trackFromId: string | null = null
  let trackToId: string | null = null
  if (trackId !== undefined) {
    if (!trackId || typeof trackId !== 'object' || Array.isArray(trackId)) {
      return buildToolError(
        'move_clip',
        'invalid_arguments',
        'trackId 如果提供，必须是包含 from 和 to 的对象。',
      )
    }

    if (typeof trackId.from !== 'string' || !trackId.from) {
      return buildToolError(
        'move_clip',
        'invalid_arguments',
        'trackId.from 如果提供 trackId，则为必填非空字符串。',
      )
    }

    if (typeof trackId.to !== 'string' || !trackId.to) {
      return buildToolError(
        'move_clip',
        'invalid_arguments',
        'trackId.to 如果提供 trackId，则为必填非空字符串。',
      )
    }

    trackFromId = trackId.from
    trackToId = trackId.to
  }

  try {
    const { store, createMoveTimelineItemCommand } = createTimelineCommandHelpers()
    const clip = store.getTimelineItem(clipId)

    if (!clip) {
      return buildToolError(
        'move_clip',
        'clip_not_found',
        `未找到片段 ${clipId}。请使用 read_track 或 read_clip_properties 确认正确 ID。`,
        { clipId },
      )
    }

    const beforeTrackId = clip.trackId
    const beforeStartFrames = clip.timeRange.timelineStartTime
    if (beforeStartFrames !== startFromParsed.frames) {
      return buildToolError(
        'move_clip',
        'clip_state_mismatch',
        `片段 ${clipId} 当前开始时间与 start.from 不一致。`,
        {
          clipId,
          expectedStart: startFromParsed.timecode,
          actualStart: framesToTimecode(beforeStartFrames),
        },
      )
    }

    if (trackFromId !== null && beforeTrackId !== trackFromId) {
      return buildToolError(
        'move_clip',
        'clip_state_mismatch',
        `片段 ${clipId} 当前轨道与 trackId.from 不一致。`,
        {
          clipId,
          expectedTrackId: trackFromId,
          actualTrackId: beforeTrackId,
        },
      )
    }

    const targetTrackId = trackToId ?? clip.trackId
    const targetTrack = store.getTrack(targetTrackId)

    if (!targetTrack) {
      return buildToolError(
        'move_clip',
        'track_not_found',
        `未找到目标轨道 ${targetTrackId}。`,
        { trackId: targetTrackId },
      )
    }

    if (!validateTrackCompatibility(targetTrack.type, clip.mediaType)) {
      return buildToolError(
        'move_clip',
        'track_type_mismatch',
        `轨道类型不匹配：${clip.mediaType} 片段只能放入 ${getExpectedTrackTypeForMedia(clip.mediaType)} 轨道。`,
        {
          clipId,
          mediaType: clip.mediaType,
          targetTrackId,
          targetTrackType: targetTrack.type,
        },
      )
    }

    const duration = clip.timeRange.timelineEndTime - clip.timeRange.timelineStartTime
    const nextEnd = startToParsed.frames + duration
    const overlapClipIds: string[] = []
    const firstConflict = findTrackConflict({
      trackId: targetTrackId,
      start: startToParsed.frames,
      end: nextEnd,
      excludeClipIds: [clipId],
    })
    if (firstConflict) {
      overlapClipIds.push(firstConflict.id)
      for (const item of store.timelineItems) {
        if (item.trackId !== targetTrackId || item.id === clipId || item.id === firstConflict.id) {
          continue
        }
        if (
          Math.max(startToParsed.frames, item.timeRange.timelineStartTime) <
          Math.min(nextEnd, item.timeRange.timelineEndTime)
        ) {
          overlapClipIds.push(item.id)
        }
      }
    }

    await executeSingleCommand(createMoveTimelineItemCommand(clip, startToParsed.frames, targetTrackId))

    const afterClip = store.getTimelineItem(clipId)
    if (!afterClip) {
      return buildToolError('move_clip', 'internal_error', `片段 ${clipId} 移动后未能重新读取。`)
    }

    const includeTrackId = beforeTrackId !== afterClip.trackId
    const includeStart = beforeStartFrames !== afterClip.timeRange.timelineStartTime

    const before = buildMoveState({
      trackId: beforeTrackId,
      startFrames: beforeStartFrames,
      includeTrackId,
      includeStart,
    })

    const after = buildMoveState({
      trackId: afterClip.trackId,
      startFrames: afterClip.timeRange.timelineStartTime,
      includeTrackId,
      includeStart,
    })

    return buildToolSuccess('move_clip', {
      clipId,
      before,
      after,
      ...(overlapClipIds.length > 0
        ? {
            warning: '发生同轨重叠',
            overlapClipIds,
          }
        : {}),
    })
  } catch (error: any) {
    return buildToolError(
      'move_clip',
      'internal_error',
      error instanceof Error ? error.message : String(error),
    )
  }
}

export const moveClipTool: ToolDefinition = {
  name: 'move_clip',
  execute: executeMoveClip,
} as ToolDefinition
