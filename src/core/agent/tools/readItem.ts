import type { ToolDefinition } from './types'
import { ClipPropertyEditService } from './clip-property/ClipPropertyEditService'
import { buildToolException, buildToolSuccess } from './utils/result'

export async function executeReadItem(args: Record<string, unknown>) {
  try {
    if (typeof args.itemId !== 'string' || !args.itemId) throw new Error('itemId 为必填项。')
    const data = await new ClipPropertyEditService().readClipProperties({
      clipId: args.itemId,
      propertyGroups: args.propertyGroups,
      sampleTime: args.sampleTime,
    })
    return buildToolSuccess('read_item', {
      ...data,
      itemId: data.clipId,
      itemType: 'clip',
    })
  } catch (error) {
    return buildToolException('read_item', error)
  }
}

export const readItemTool: ToolDefinition = {
  name: 'read_item',
  execute: executeReadItem,
} as ToolDefinition
