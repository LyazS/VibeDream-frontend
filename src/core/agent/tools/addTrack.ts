import type { ToolDefinition } from './types'
import { createTrackCommandHelpers, executeSingleTrackCommand } from './trackEditShared'

export async function executeAddTrack(args: Record<string, unknown>) {
  const { trackType, position } = args

  if (trackType !== 'video' && trackType !== 'audio' && trackType !== 'text') {
    return {
      success: false,
      output: JSON.stringify(
        { tool: 'add_track', error: 'trackType 必须是 video、audio 或 text。' },
        null,
        2,
      ),
      error: 'trackType 必须是 video、audio 或 text。',
    }
  }

  if (
    position !== undefined &&
    (typeof position !== 'number' || !Number.isInteger(position) || position < 0)
  ) {
    return {
      success: false,
      output: JSON.stringify(
        { tool: 'add_track', error: 'position 必须是大于等于 0 的整数。' },
        null,
        2,
      ),
      error: 'position 必须是大于等于 0 的整数。',
    }
  }

  try {
    const { store, createAddTrackCommand } = createTrackCommandHelpers()
    const beforeIds = new Set(store.tracks.map((track) => track.id))
    await executeSingleTrackCommand(createAddTrackCommand(trackType, position))

    const createdTrack = store.tracks.find((track) => !beforeIds.has(track.id))
    if (!createdTrack) {
      return {
        success: false,
        output: JSON.stringify(
          { tool: 'add_track', error: '轨道创建成功，但未能定位新轨道。' },
          null,
          2,
        ),
        error: '轨道创建成功，但未能定位新轨道。',
      }
    }

    const index = store.tracks.findIndex((track) => track.id === createdTrack.id)
    return {
      success: true,
      output: JSON.stringify(
        {
          tool: 'add_track',
          trackId: createdTrack.id,
          index,
        },
        null,
        2,
      ),
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return {
      success: false,
      output: JSON.stringify({ tool: 'add_track', error: message }, null, 2),
      error: message,
    }
  }
}

export const addTrackTool: ToolDefinition = {
  name: 'add_track',
  execute: executeAddTrack,
} as ToolDefinition
