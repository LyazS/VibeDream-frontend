import type { ToolDefinition } from '../core/toolTypes'
import { buildToolError, buildToolSuccess } from './utils/result'
import {
  createTrackCommandHelpers,
  executeSingleTrackCommand,
} from './trackEditShared'

export async function executeSetTrackVisibility(args: Record<string, any>) {
  const { trackId, visible } = args

  if (typeof trackId !== 'string' || !trackId) {
    return buildToolError('set_track_visibility', 'invalid_arguments', 'trackId 是必填字符串。')
  }

  if (typeof visible !== 'boolean') {
    return buildToolError('set_track_visibility', 'invalid_arguments', 'visible 必须是布尔值。')
  }

  try {
    const { store, createSetTrackVisibilityCommand } = createTrackCommandHelpers()
    const track = store.getTrack(trackId)
    if (!track) {
      return buildToolError(
        'set_track_visibility',
        'track_not_found',
        `未找到轨道 ${trackId}。请使用 list_tracks 查看正确轨道 ID。`,
        { trackId },
      )
    }

    if (track.type === 'audio') {
      return buildToolError(
        'set_track_visibility',
        'invalid_operation',
        'audio 轨道不支持可见性设置。',
        { trackId, trackType: track.type },
      )
    }

    const beforeVisible = track.isVisible
    await executeSingleTrackCommand(createSetTrackVisibilityCommand(trackId, visible))

    return buildToolSuccess(
      'set_track_visibility',
      {
        trackId,
        before: { visible: beforeVisible },
        after: { visible: store.getTrack(trackId)?.isVisible ?? visible },
      },
      `已将轨道 ${trackId} 设置为${visible ? '可见' : '隐藏'}。`,
    )
  } catch (error: any) {
    return buildToolError(
      'set_track_visibility',
      'internal_error',
      error instanceof Error ? error.message : String(error),
    )
  }
}

export const setTrackVisibilityTool: ToolDefinition = {
  name: 'set_track_visibility',
  execute: executeSetTrackVisibility,
} as ToolDefinition
