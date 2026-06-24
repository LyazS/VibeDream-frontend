import { setupTimelineItemBunny } from '@/core/bunnyUtils/timelineItemSetup'
import { TimelineItemMutations } from '@/core/timelineitem/mutations'
import { framesToTimecode } from '@/core/utils/timeUtils'
import { createTextTimelineItem } from '@/core/utils/textTimelineUtils'
import type { ToolDefinition } from '../core/toolTypes'
import { buildToolError, buildToolSuccess } from './utils/result'
import {
  buildClipSnapshot,
  createTimelineCommandHelpers,
  executeSingleCommand,
  findTrackConflict,
  parseRequiredTimecode,
} from './timelineEditShared'

export async function executeCreateSubtitleClip(args: Record<string, any>) {
  const { text, trackId, startTime, duration } = args

  if (typeof text !== 'string' || !text.trim()) {
    return buildToolError('create_subtitle_clip', 'invalid_arguments', 'text 是必填非空字符串。')
  }

  if (typeof trackId !== 'string' || !trackId) {
    return buildToolError('create_subtitle_clip', 'invalid_arguments', 'trackId 是必填字符串。')
  }

  const startParsed = parseRequiredTimecode('create_subtitle_clip', startTime, 'startTime')
  if (!startParsed.ok) {
    return startParsed.error
  }

  const durationParsed = parseRequiredTimecode('create_subtitle_clip', duration, 'duration')
  if (!durationParsed.ok) {
    return durationParsed.error
  }

  if (durationParsed.frames <= 0) {
    return buildToolError(
      'create_subtitle_clip',
      'invalid_duration',
      'duration 必须大于 00:00:00+00。',
      { duration },
    )
  }

  try {
    const { store, createAddTimelineItemCommand } = createTimelineCommandHelpers()
    const track = store.getTrack(trackId)

    if (!track) {
      return buildToolError(
        'create_subtitle_clip',
        'track_not_found',
        `目标轨道不存在: ${trackId}`,
        { trackId },
      )
    }

    if (track.type !== 'text') {
      return buildToolError(
        'create_subtitle_clip',
        'track_type_mismatch',
        `字幕 clip 只能创建到文本轨道，当前轨道类型为 ${track.type}。`,
        { trackId, trackType: track.type },
      )
    }

    const timelineEndFrames = startParsed.frames + durationParsed.frames
    const conflict = findTrackConflict({
      trackId,
      start: startParsed.frames,
      end: timelineEndFrames,
    })
    if (conflict) {
      return buildToolError(
        'create_subtitle_clip',
        'timeline_conflict',
        `目标区间与现有片段 ${conflict.id} 冲突，已拒绝创建字幕。`,
        {
          conflictClipId: conflict.id,
          trackId,
          requestedRange: {
            start: startParsed.timecode,
            end: framesToTimecode(timelineEndFrames),
          },
        },
      )
    }

    const nextItem = await createTextTimelineItem(
      text.trim(),
      {},
      startParsed.frames,
      trackId,
      durationParsed.frames,
    )

    await setupTimelineItemBunny(nextItem)

    if (nextItem.runtime.textBitmap) {
      TimelineItemMutations.patchBaseVisualConfig(nextItem, {
        width: nextItem.runtime.textBitmap.width,
        height: nextItem.runtime.textBitmap.height,
      })
    }

    await executeSingleCommand(createAddTimelineItemCommand(nextItem))

    const snapshot = buildClipSnapshot(nextItem)
    return buildToolSuccess(
      'create_subtitle_clip',
      {
        clipId: nextItem.id,
        trackId,
        mediaType: nextItem.mediaType,
        text: text.trim(),
        timeline: snapshot.timeline,
      },
      `已在轨道 ${trackId} 的 ${startParsed.timecode} 创建字幕 clip。`,
    )
  } catch (error: any) {
    return buildToolError(
      'create_subtitle_clip',
      'internal_error',
      error instanceof Error ? error.message : String(error),
    )
  }
}

export const createSubtitleClipTool: ToolDefinition = {
  name: 'create_subtitle_clip',
  execute: executeCreateSubtitleClip,
} as ToolDefinition
