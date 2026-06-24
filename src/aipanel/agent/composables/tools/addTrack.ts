import type { UnifiedTrackType } from '@/core/track/TrackTypes'
import type { ToolDefinition } from '../core/toolTypes'
import { buildToolError, buildToolSuccess } from './utils/result'
import {
  createTrackCommandHelpers,
  executeSingleTrackCommand,
} from './trackEditShared'

const VALID_TRACK_TYPES: UnifiedTrackType[] = ['video', 'audio', 'text']

export async function executeAddTrack(args: Record<string, any>) {
  const { trackType, position } = args

  if (!VALID_TRACK_TYPES.includes(trackType)) {
    return buildToolError(
      'add_track',
      'invalid_arguments',
      'trackType 必须是 video、audio 或 text。',
      { trackType },
    )
  }

  if (position !== undefined && (!Number.isInteger(position) || position < 0)) {
    return buildToolError(
      'add_track',
      'invalid_arguments',
      'position 必须是大于等于 0 的整数。',
      { position },
    )
  }

  try {
    const { store, createAddTrackCommand } = createTrackCommandHelpers()
    const beforeIds = new Set(store.tracks.map((track) => track.id))
    await executeSingleTrackCommand(createAddTrackCommand(trackType, position))

    const createdTrack = store.tracks.find((track) => !beforeIds.has(track.id))
    if (!createdTrack) {
      return buildToolError('add_track', 'internal_error', '轨道创建成功，但未能定位新轨道。')
    }

    const index = store.tracks.findIndex((track) => track.id === createdTrack.id)
    return buildToolSuccess(
      'add_track',
      {
        trackId: createdTrack.id,
        type: createdTrack.type,
        index,
      },
      `已新增 ${createdTrack.type} 轨道 ${createdTrack.id}。`,
    )
  } catch (error: any) {
    return buildToolError(
      'add_track',
      'internal_error',
      error instanceof Error ? error.message : String(error),
    )
  }
}

export const addTrackTool: ToolDefinition = {
  name: 'add_track',
  execute: executeAddTrack,
} as ToolDefinition
