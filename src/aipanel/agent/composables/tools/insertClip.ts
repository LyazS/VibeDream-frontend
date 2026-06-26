import { framesToTimecode } from '@/core/utils/timeUtils'
import type { ToolDefinition } from '../core/toolTypes'
import { buildToolError, buildToolSuccess } from './utils/result'
import {
  buildClipSnapshot,
  buildTimelineItemFromMedia,
  createTimelineCommandHelpers,
  ensureMediaReadyForInsert,
  executeSingleCommand,
  findTrackConflict,
  parseRequiredTimecode,
} from './timelineEditShared'

export async function executeInsertClip(args: Record<string, any>) {
  const { mediaId, trackId, startTime, clipStartTime, clipEndTime } = args

  if (typeof mediaId !== 'string' || !mediaId) {
    return buildToolError('insert_clip', 'invalid_arguments', 'mediaId 是必填字符串。')
  }

  if (typeof trackId !== 'string' || !trackId) {
    return buildToolError('insert_clip', 'invalid_arguments', 'trackId 是必填字符串。')
  }

  const startParsed = parseRequiredTimecode('insert_clip', startTime, 'startTime')
  if (!startParsed.ok) {
    return startParsed.error
  }

  const clipStartParsed =
    clipStartTime === undefined
      ? undefined
      : parseRequiredTimecode('insert_clip', clipStartTime, 'clipStartTime')
  if (clipStartParsed && !clipStartParsed.ok) {
    return clipStartParsed.error
  }

  const clipEndParsed =
    clipEndTime === undefined
      ? undefined
      : parseRequiredTimecode('insert_clip', clipEndTime, 'clipEndTime')
  if (clipEndParsed && !clipEndParsed.ok) {
    return clipEndParsed.error
  }

  try {
    const { store, createAddTimelineItemCommand } = createTimelineCommandHelpers()
    const mediaItem = store.getMediaItem(mediaId)

    if (!mediaItem) {
      return buildToolError(
        'insert_clip',
        'media_not_found',
        `未找到素材 ${mediaId}。请先使用 list_media 或 search_media 确认素材 ID。`,
        { mediaId },
      )
    }

    const readyMediaItem = await ensureMediaReadyForInsert(mediaId)

    const nextItem = buildTimelineItemFromMedia({
      mediaItem: readyMediaItem,
      trackId,
      timelineStartTime: startParsed.frames,
      clipStartTime: clipStartParsed?.frames,
      clipEndTime: clipEndParsed?.frames,
    })

    const conflict = findTrackConflict({
      trackId,
      start: nextItem.timeRange.timelineStartTime,
      end: nextItem.timeRange.timelineEndTime,
    })

    await executeSingleCommand(createAddTimelineItemCommand(nextItem))

    return buildToolSuccess(
      'insert_clip',
      {
        clipId: nextItem.id,
        mediaId,
        trackId,
        timeline: {
          start: startParsed.timecode,
          end: framesToTimecode(nextItem.timeRange.timelineEndTime),
        },
        ...(conflict
          ? {
              warning: `已执行，但与同轨片段发生重叠：${conflict.id}`,
              conflict: {
                clipIds: [conflict.id],
                trackId,
                requestedRange: {
                  start: startParsed.timecode,
                  end: buildClipSnapshot(nextItem).timeline.end,
                },
              },
            }
          : {}),
      },
      conflict
        ? `已将素材 ${mediaId} 插入到轨道 ${trackId} 的 ${startParsed.timecode}，但与同轨片段发生重叠。`
        : `已将素材 ${mediaId} 插入到轨道 ${trackId} 的 ${startParsed.timecode}。`,
    )
  } catch (error: any) {
    return buildToolError(
      'insert_clip',
      'internal_error',
      error instanceof Error ? error.message : String(error),
    )
  }
}

export const insertClipTool: ToolDefinition = {
  name: 'insert_clip',
  execute: executeInsertClip,
} as ToolDefinition
