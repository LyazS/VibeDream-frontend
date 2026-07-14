import type { ToolDefinition } from '../core/toolTypes'
import { ClipPropertyEditService } from './clip-property/ClipPropertyEditService'
import { parseTransitionItemId } from './transitionItemId'
import { executeUpdateTransitionItem } from './transitionTools'
import { buildToolError, buildToolSuccess } from './utils/result'

export async function executeUpdateItem(args: Record<string, any>) {
  try {
    if (typeof args.itemId !== 'string' || !args.itemId) throw new Error('itemId 为必填项。')
    const data = parseTransitionItemId(args.itemId)
      ? await executeUpdateTransitionItem(args.itemId, args.match, args.apply)
      : await new ClipPropertyEditService().updateClipProperties({ clipId: args.itemId, match: args.match, apply: args.apply })
    return buildToolSuccess('update_item', { ...data, itemId: args.itemId, itemType: parseTransitionItemId(args.itemId) ? 'transition' : 'clip' })
  } catch (error: any) {
    return buildToolError('update_item', error?.toolCode || 'internal_error', error instanceof Error ? error.message : String(error), error?.toolDetails)
  }
}

export const updateItemTool: ToolDefinition = { name: 'update_item', execute: executeUpdateItem } as ToolDefinition
