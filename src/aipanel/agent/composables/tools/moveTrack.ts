import type { ToolDefinition } from '../core/toolTypes'
import { buildToolError, buildToolSuccess } from './utils/result'
import {
  createTrackCommandHelpers,
  executeSingleTrackCommand,
  findTrackIndex,
} from './trackEditShared'

export async function executeMoveTrack(args: Record<string, any>) {
  const { trackId, toIndex } = args

  if (typeof trackId !== 'string' || !trackId) {
    return buildToolError('move_track', 'invalid_arguments', 'trackId 是必填字符串。')
  }

  if (!Number.isInteger(toIndex) || toIndex < 0) {
    return buildToolError('move_track', 'invalid_arguments', 'toIndex 必须是大于等于 0 的整数。')
  }

  try {
    const { store, createMoveTrackCommand } = createTrackCommandHelpers()
    const track = store.getTrack(trackId)
    if (!track) {
      return buildToolError(
        'move_track',
        'track_not_found',
        `未找到轨道 ${trackId}。请使用 list_tracks 查看正确轨道 ID。`,
        { trackId },
      )
    }

    const fromIndex = findTrackIndex(trackId)
    if (fromIndex === -1) {
      return buildToolError('move_track', 'internal_error', `无法获取轨道 ${trackId} 的当前位置。`)
    }

    if (toIndex >= store.tracks.length) {
      return buildToolError(
        'move_track',
        'invalid_arguments',
        `toIndex 超出轨道范围，当前最大可用索引为 ${store.tracks.length - 1}。`,
        { toIndex, trackCount: store.tracks.length },
      )
    }

    await executeSingleTrackCommand(createMoveTrackCommand(trackId, fromIndex, toIndex))

    return buildToolSuccess(
      'move_track',
      {
        trackId,
        before: { index: fromIndex },
        after: { index: toIndex },
      },
      `已将轨道 ${trackId} 从位置 ${fromIndex} 移动到 ${toIndex}。`,
    )
  } catch (error: any) {
    return buildToolError(
      'move_track',
      'internal_error',
      error instanceof Error ? error.message : String(error),
    )
  }
}

export const moveTrackTool: ToolDefinition = {
  name: 'move_track',
  execute: executeMoveTrack,
} as ToolDefinition
