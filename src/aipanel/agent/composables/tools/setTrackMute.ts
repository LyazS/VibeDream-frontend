import type { ToolDefinition } from '../core/toolTypes'
import { buildToolError, buildToolSuccess } from './utils/result'
import {
  createTrackCommandHelpers,
  executeSingleTrackCommand,
} from './trackEditShared'

export async function executeSetTrackMute(args: Record<string, any>) {
  const { trackId, muted } = args

  if (typeof trackId !== 'string' || !trackId) {
    return buildToolError('set_track_mute', 'invalid_arguments', 'trackId 是必填字符串。')
  }

  if (typeof muted !== 'boolean') {
    return buildToolError('set_track_mute', 'invalid_arguments', 'muted 必须是布尔值。')
  }

  try {
    const { store, createSetTrackMuteCommand } = createTrackCommandHelpers()
    const track = store.getTrack(trackId)
    if (!track) {
      return buildToolError(
        'set_track_mute',
        'track_not_found',
        `未找到轨道 ${trackId}。请使用 list_tracks 查看正确轨道 ID。`,
        { trackId },
      )
    }

    if (track.type === 'text') {
      return buildToolError(
        'set_track_mute',
        'invalid_operation',
        'text 轨道不支持静音设置。',
        { trackId, trackType: track.type },
      )
    }

    const beforeMuted = track.isMuted
    await executeSingleTrackCommand(createSetTrackMuteCommand(trackId, muted))

    return buildToolSuccess(
      'set_track_mute',
      {
        trackId,
        before: { muted: beforeMuted },
        after: { muted: store.getTrack(trackId)?.isMuted ?? muted },
      },
      `已将轨道 ${trackId} 设置为${muted ? '静音' : '非静音'}。`,
    )
  } catch (error: any) {
    return buildToolError(
      'set_track_mute',
      'internal_error',
      error instanceof Error ? error.message : String(error),
    )
  }
}

export const setTrackMuteTool: ToolDefinition = {
  name: 'set_track_mute',
  execute: executeSetTrackMute,
} as ToolDefinition
