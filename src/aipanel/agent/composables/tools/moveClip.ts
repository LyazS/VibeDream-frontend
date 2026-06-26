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
  includeStartTime: boolean
}) {
  return {
    ...(params.includeTrackId ? { trackId: params.trackId } : {}),
    ...(params.includeStartTime ? { startTime: framesToTimecode(params.startFrames) } : {}),
  }
}

export async function executeMoveClip(args: Record<string, any>) {
  const { clipId, toStartTime, toTrackId } = args

  if (typeof clipId !== 'string' || !clipId) {
    return buildToolError('move_clip', 'invalid_arguments', 'clipId 是必填字符串。')
  }

  const startParsed = parseRequiredTimecode('move_clip', toStartTime, 'toStartTime')
  if (!startParsed.ok) {
    return startParsed.error
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
    const targetTrackId = typeof toTrackId === 'string' && toTrackId ? toTrackId : clip.trackId
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
    const nextEnd = startParsed.frames + duration
    const conflict = findTrackConflict({
      trackId: targetTrackId,
      start: startParsed.frames,
      end: nextEnd,
      excludeClipIds: [clipId],
    })
    if (conflict) {
      return buildToolError(
        'move_clip',
        'timeline_conflict',
        `目标区间与现有片段 ${conflict.id} 冲突，已拒绝移动。`,
        {
          clipId,
          conflictClipId: conflict.id,
          targetTrackId,
        },
      )
    }

    await executeSingleCommand(createMoveTimelineItemCommand(clip, startParsed.frames, targetTrackId))

    const afterClip = store.getTimelineItem(clipId)
    if (!afterClip) {
      return buildToolError('move_clip', 'internal_error', `片段 ${clipId} 移动后未能重新读取。`)
    }

    const includeTrackId = beforeTrackId !== afterClip.trackId
    const includeStartTime = beforeStartFrames !== afterClip.timeRange.timelineStartTime

    const before = buildMoveState({
      trackId: beforeTrackId,
      startFrames: beforeStartFrames,
      includeTrackId,
      includeStartTime,
    })

    const after = buildMoveState({
      trackId: afterClip.trackId,
      startFrames: afterClip.timeRange.timelineStartTime,
      includeTrackId,
      includeStartTime,
    })

    return buildToolSuccess(
      'move_clip',
      {
        clipId,
        before,
        after,
      },
      `已将 ${clipId} 移动到轨道 ${afterClip.trackId} 的 ${startParsed.timecode}。`,
    )
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
