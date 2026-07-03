import type { ToolDefinition } from '../core/toolTypes'
import { ClipPropertyEditService } from './clip-property/ClipPropertyEditService'

export async function executeReadClipProperties(args: Record<string, any>) {
  const service = new ClipPropertyEditService()

  try {
    const data = await service.readClipProperties({
      clipId: args.clipId,
      propertyGroups: args.propertyGroups,
      sampleTime: args.sampleTime,
    })

    return {
      success: true,
      output: JSON.stringify({
        tool: 'read_clip_properties',
        ...data,
        summary: `已读取 ${data.clipId} 的 ${Object.keys(data.groups).join('、')} 属性组。`,
      }, null, 2),
    }
  } catch (error: any) {
    const message = error instanceof Error ? error.message : String(error)
    return {
      success: false,
      output: JSON.stringify({ tool: 'read_clip_properties', error: message }, null, 2),
      error: message,
    }
  }
}

export const readClipPropertiesTool: ToolDefinition = {
  name: 'read_clip_properties',
  execute: executeReadClipProperties,
} as ToolDefinition
