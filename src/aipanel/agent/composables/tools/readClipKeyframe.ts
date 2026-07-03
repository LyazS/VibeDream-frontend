import type { ToolDefinition } from '../core/toolTypes'
import { KeyframePropertyEditService } from './keyframe-property/KeyframePropertyEditService'

export async function executeReadClipKeyframe(args: Record<string, any>) {
  const service = new KeyframePropertyEditService()

  try {
    const data = await service.readClipKeyframe({
      clipId: args.clipId,
      propertyId: args.propertyId,
    })

    return {
      success: true,
      output: JSON.stringify({
        tool: 'read_clip_keyframe',
        clipId: data.clipId,
        mediaType: data.mediaType,
        propertyId: data.propertyId,
        timelineRange: data.timelineRange,
        keyframes: data.keyframes,
      }, null, 2),
    }
  } catch (error: any) {
    const message = error instanceof Error ? error.message : String(error)
    return {
      success: false,
      output: JSON.stringify({ tool: 'read_clip_keyframe', error: message }, null, 2),
      error: message,
    }
  }
}

export const readClipKeyframeTool: ToolDefinition = {
  name: 'read_clip_keyframe',
  execute: executeReadClipKeyframe,
} as ToolDefinition
