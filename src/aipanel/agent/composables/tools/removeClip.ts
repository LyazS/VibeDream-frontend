import type { ToolDefinition } from '../core/toolTypes'
import { buildToolError, buildToolSuccess } from './utils/result'
import { createTimelineCommandHelpers } from './timelineEditShared'

export async function executeRemoveClip(args: Record<string, any>) {
  const { clipIds } = args

  if (!Array.isArray(clipIds) || clipIds.length === 0) {
    return buildToolError('remove_clip', 'invalid_arguments', 'clipIds 必须是非空数组。')
  }

  if (!clipIds.every((id) => typeof id === 'string' && id)) {
    return buildToolError('remove_clip', 'invalid_arguments', 'clipIds 中的每一项都必须是非空字符串。')
  }

  try {
    const { store, createRemoveTimelineItemCommand } = createTimelineCommandHelpers()
    const missingIds = clipIds.filter((id) => !store.getTimelineItem(id))
    if (missingIds.length > 0) {
      return buildToolError(
        'remove_clip',
        'clip_not_found',
        `以下片段不存在：${missingIds.join(', ')}`,
        { missingIds },
      )
    }

    const batch = store.startBatch(`删除 ${clipIds.length} 个片段`)
    for (const clipId of clipIds) {
      batch.addCommand(createRemoveTimelineItemCommand(clipId))
    }
    await store.executeBatchCommand(batch.build())

    return buildToolSuccess(
      'remove_clip',
      {
        removedClipIds: clipIds,
      },
      `已删除 ${clipIds.length} 个片段。`,
    )
  } catch (error: any) {
    return buildToolError(
      'remove_clip',
      'internal_error',
      error instanceof Error ? error.message : String(error),
    )
  }
}

export const removeClipTool: ToolDefinition = {
  name: 'remove_clip',
  execute: executeRemoveClip,
} as ToolDefinition
