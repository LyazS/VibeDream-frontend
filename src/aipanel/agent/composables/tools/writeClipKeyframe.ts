import type { ToolDefinition } from '../core/toolTypes'
import { KeyframeChannelEditService } from './keyframe-channel/KeyframeChannelEditService'

export async function executeWriteClipKeyframe(args: Record<string, any>) {
  const service = new KeyframeChannelEditService()

  try {
    const data = await service.writeClipKeyframe({
      clipId: args.clipId,
      channelId: args.channelId,
      keyframes: args.keyframes,
      options: args.options,
    })

    return {
      success: true,
      output: JSON.stringify({
        tool: 'write_clip_keyframe',
        ...data,
        summary: `已重写 ${data.clipId} 的 ${data.channelId} 通道。`,
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
