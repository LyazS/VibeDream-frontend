import type { ToolDefinition } from '../core/toolTypes'
import { KeyframePropertyEditService } from './keyframe-property/KeyframePropertyEditService'

export async function executeWriteClipKeyframe(args: Record<string, any>) {
  const service = new KeyframePropertyEditService()

  try {
    const data = await service.writeClipKeyframe({
      clipId: args.clipId,
      propertyId: args.propertyId,
      keyframes: args.keyframes,
      options: args.options,
    })

    return {
      success: true,
      output: JSON.stringify({
        tool: 'write_clip_keyframe',
        clipId: data.clipId,
        propertyId: data.propertyId,
        status: data.status,
      }, null, 2),
    }
  } catch (error: any) {
    const message = error instanceof Error ? error.message : String(error)
    return {
      success: false,
      output: JSON.stringify({ tool: 'write_clip_keyframe', error: message }, null, 2),
      error: message,
    }
  }
}

export const writeClipKeyframeTool: ToolDefinition = {
  name: 'write_clip_keyframe',
  execute: executeWriteClipKeyframe,
} as ToolDefinition
