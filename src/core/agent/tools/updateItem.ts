import type { ToolDefinition } from './types'
import { ClipPropertyEditService } from './clip-property/ClipPropertyEditService'
import { parseTransitionItemId } from './transitionItemId'
import { executeUpdateTransitionItem } from './transitionTools'
import { buildToolException, buildToolSuccess } from './utils/result'
import { isRecord } from '@/utils/typeGuards'

export async function executeUpdateItem(args: Record<string, unknown>) {
  try {
    if (typeof args.itemId !== 'string' || !args.itemId) throw new Error('itemId 为必填项。')
    if (!isRecord(args.match) || !isRecord(args.apply))
      throw new Error('match 和 apply 必须是对象。')
    const data = parseTransitionItemId(args.itemId)
      ? await executeUpdateTransitionItem(args.itemId, args.match, args.apply)
      : await new ClipPropertyEditService().updateClipProperties({
          clipId: args.itemId,
          match: args.match,
          apply: args.apply,
        })
    return buildToolSuccess('update_item', {
      ...data,
      itemId: args.itemId,
      itemType: parseTransitionItemId(args.itemId) ? 'transition' : 'clip',
    })
  } catch (error) {
    return buildToolException('update_item', error)
  }
}

export const updateItemTool: ToolDefinition = {
  name: 'update_item',
  execute: executeUpdateItem,
} as ToolDefinition
