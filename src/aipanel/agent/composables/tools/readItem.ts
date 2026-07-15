import type { ToolDefinition } from '../core/toolTypes'
import { ClipPropertyEditService } from './clip-property/ClipPropertyEditService'
import { parseTransitionItemId } from './transitionItemId'
import { executeReadTransitionItem } from './transitionTools'
import { buildToolError, buildToolSuccess } from './utils/result'

export async function executeReadItem(args: Record<string, any>) {
  try {
    if (typeof args.itemId !== 'string' || !args.itemId) throw new Error('itemId 为必填项。')
    const data = parseTransitionItemId(args.itemId)
      ? await executeReadTransitionItem(args.itemId, args.propertyGroups)
      : await new ClipPropertyEditService().readClipProperties({ clipId: args.itemId, propertyGroups: args.propertyGroups, sampleTime: args.sampleTime })
    const itemId = 'clipId' in data ? data.clipId : data.itemId
    return buildToolSuccess('read_item', { ...data, itemId, itemType: parseTransitionItemId(args.itemId) ? 'transition' : 'clip' })
  } catch (error: any) {
    return buildToolError('read_item', error?.toolCode || 'internal_error', error instanceof Error ? error.message : String(error), error?.toolDetails)
  }
}

export const readItemTool: ToolDefinition = { name: 'read_item', execute: executeReadItem } as ToolDefinition
