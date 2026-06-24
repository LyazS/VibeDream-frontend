import type { ToolDefinition } from '../core/toolTypes'
import { buildToolError, buildToolSuccess } from './utils/result'
import {
  createTrackCommandHelpers,
  executeSingleTrackCommand,
} from './trackEditShared'

export async function executeRemoveTrack(args: Record<string, any>) {
  const { trackId } = args

  if (typeof trackId !== 'string' || !trackId) {
    return buildToolError('remove_track', 'invalid_arguments', 'trackId 是必填字符串。')
  }

  try {
    const { store, createRemoveTrackCommand } = createTrackCommandHelpers()
    const track = store.getTrack(trackId)
    if (!track) {
      return buildToolError(
        'remove_track',
        'track_not_found',
        `未找到轨道 ${trackId}。请使用 list_tracks 查看正确轨道 ID。`,
        { trackId },
      )
    }

    if (store.tracks.length <= 1) {
      return buildToolError('remove_track', 'invalid_operation', '不能删除最后一个轨道。')
    }

    await executeSingleTrackCommand(createRemoveTrackCommand(trackId))

    return buildToolSuccess(
      'remove_track',
      {
        trackId,
      },
      `已删除轨道 ${trackId}。`,
    )
  } catch (error: any) {
    return buildToolError(
      'remove_track',
      'internal_error',
      error instanceof Error ? error.message : String(error),
    )
  }
}

export const removeTrackTool: ToolDefinition = {
  name: 'remove_track',
  execute: executeRemoveTrack,
} as ToolDefinition
