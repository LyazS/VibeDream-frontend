import type { ToolDefinition } from '../core/toolTypes'
import { buildToolError, buildToolSuccess } from './utils/result'
import { createTrackCommandHelpers, executeSingleTrackCommand } from './trackEditShared'

export async function executeRenameTrack(args: Record<string, any>) {
  const { trackId, newName } = args

  if (typeof trackId !== 'string' || !trackId) {
    return buildToolError('rename_track', 'invalid_arguments', 'trackId 是必填字符串。')
  }

  if (typeof newName !== 'string' || !newName.trim()) {
    return buildToolError('rename_track', 'invalid_arguments', 'newName 必须是非空字符串。')
  }

  try {
    const { store, createRenameTrackCommand } = createTrackCommandHelpers()
    const track = store.getTrack(trackId)
    if (!track) {
      return buildToolError(
        'rename_track',
        'track_not_found',
        `未找到轨道 ${trackId}。请使用 list_tracks 查看正确轨道 ID。`,
        { trackId },
      )
    }

    const beforeName = track.name
    await executeSingleTrackCommand(createRenameTrackCommand(trackId, newName))

    return buildToolSuccess(
      'rename_track',
      {
        trackId,
        before: { name: beforeName },
        after: { name: store.getTrack(trackId)?.name ?? newName.trim() },
      },
      `已将轨道 ${trackId} 重命名为 ${newName.trim()}。`,
    )
  } catch (error: any) {
    return buildToolError(
      'rename_track',
      'internal_error',
      error instanceof Error ? error.message : String(error),
    )
  }
}

export const renameTrackTool: ToolDefinition = {
  name: 'rename_track',
  execute: executeRenameTrack,
} as ToolDefinition
