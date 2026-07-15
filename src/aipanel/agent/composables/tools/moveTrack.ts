import type { ToolDefinition } from '../core/toolTypes'
import {
  createTrackCommandHelpers,
  executeSingleTrackCommand,
  findTrackIndex,
} from './trackEditShared'

export async function executeMoveTrack(args: Record<string, any>) {
  const { trackId, index } = args

  if (typeof trackId !== 'string' || !trackId) {
    return {
      success: false,
      output: JSON.stringify({ tool: 'move_track', error: 'trackId 是必填字符串。' }, null, 2),
      error: 'trackId 是必填字符串。',
    }
  }

  if (!index || typeof index !== 'object' || Array.isArray(index)) {
    return {
      success: false,
      output: JSON.stringify({ tool: 'move_track', error: 'index 是必填对象，且必须包含 from 和 to。' }, null, 2),
      error: 'index 是必填对象，且必须包含 from 和 to。',
    }
  }

  if (!Number.isInteger(index.from) || index.from < 0) {
    return {
      success: false,
      output: JSON.stringify({ tool: 'move_track', error: 'index.from 必须是大于等于 0 的整数。' }, null, 2),
      error: 'index.from 必须是大于等于 0 的整数。',
    }
  }

  if (!Number.isInteger(index.to) || index.to < 0) {
    return {
      success: false,
      output: JSON.stringify({ tool: 'move_track', error: 'index.to 必须是大于等于 0 的整数。' }, null, 2),
      error: 'index.to 必须是大于等于 0 的整数。',
    }
  }

  try {
    const { store, createMoveTrackCommand } = createTrackCommandHelpers()
    const track = store.getTrack(trackId)
    if (!track) {
      const message = `未找到轨道 ${trackId}。请使用 list_tracks 查看正确轨道 ID。`
      return {
        success: false,
        output: JSON.stringify({ tool: 'move_track', error: message }, null, 2),
        error: message,
      }
    }

    const fromIndex = findTrackIndex(trackId)
    if (fromIndex === -1) {
      const message = `无法获取轨道 ${trackId} 的当前位置。`
      return {
        success: false,
        output: JSON.stringify({ tool: 'move_track', error: message }, null, 2),
        error: message,
      }
    }

    if (fromIndex !== index.from) {
      const message = `轨道 ${trackId} 当前索引与 index.from 不一致：期望 ${index.from}，实际 ${fromIndex}。`
      return {
        success: false,
        output: JSON.stringify({ tool: 'move_track', error: message }, null, 2),
        error: message,
      }
    }

    if (index.to >= store.tracks.length) {
      const message = `index.to 超出轨道范围，当前最大可用索引为 ${store.tracks.length - 1}。`
      return {
        success: false,
        output: JSON.stringify({ tool: 'move_track', error: message }, null, 2),
        error: message,
      }
    }

    await executeSingleTrackCommand(createMoveTrackCommand(trackId, fromIndex, index.to))

    return {
      success: true,
      output: JSON.stringify({
        tool: 'move_track',
        trackId,
        before: { index: fromIndex },
        after: { index: index.to },
      }, null, 2),
    }
  } catch (error: any) {
    const message = error instanceof Error ? error.message : String(error)
    return {
      success: false,
      output: JSON.stringify({ tool: 'move_track', error: message }, null, 2),
      error: message,
    }
  }
}

export const moveTrackTool: ToolDefinition = {
  name: 'move_track',
  execute: executeMoveTrack,
} as ToolDefinition
