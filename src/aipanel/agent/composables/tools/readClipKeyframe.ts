import type { ToolDefinition } from '../core/toolTypes'
import { KeyframeChannelEditService } from './keyframe-channel/KeyframeChannelEditService'

export async function executeReadClipKeyframe(args: Record<string, any>) {
  const service = new KeyframeChannelEditService()

  try {
    const data = await service.readClipKeyframe({
      itemId: args.itemId,
      channelId: args.channelId,
    })

    return {
      success: true,
      output: JSON.stringify({
        tool: 'read_clip_keyframe',
        ...data,
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
