import { useUnifiedStore } from '@/core/unifiedStore'
import type { ToolDefinition } from './types'
import { buildToolException, buildToolSuccess } from './utils/result'

export async function executeRemoveItem(args: Record<string, unknown>) {
  try {
    if (!Array.isArray(args.itemIds) || args.itemIds.length === 0) {
      throw new Error('itemIds 必须是非空数组。')
    }

    const itemIds = Array.from(
      new Set(args.itemIds.filter((itemId): itemId is string => typeof itemId === 'string' && itemId.length > 0)),
    )
    if (itemIds.length !== args.itemIds.length) {
      throw new Error('itemIds 只能包含非空字符串。')
    }

    const store = useUnifiedStore()
    for (const itemId of itemIds) {
      if (!store.getTimelineItem(itemId)) {
        throw new Error(`未找到时间轴片段 ${itemId}。`)
      }
    }

    for (const itemId of itemIds) {
      await store.removeTimelineItemWithHistory(itemId)
    }

    return buildToolSuccess('remove_item', { removedItemIds: itemIds })
  } catch (error) {
    return buildToolException('remove_item', error)
  }
}

export const removeItemTool: ToolDefinition = {
  name: 'remove_item',
  execute: executeRemoveItem,
} as ToolDefinition
