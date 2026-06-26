import type { ToolDefinition } from '../core/toolTypes'
import { buildToolError, buildToolSuccess } from './utils/result'
import { KeyframeChannelEditService } from './keyframe-channel/KeyframeChannelEditService'

export async function executeWriteClipKeyframe(args: Record<string, any>) {
  const service = new KeyframeChannelEditService()

  try {
    const data = await service.writeClipKeyframe({
      itemId: args.itemId,
      groupId: args.groupId,
      keyframes: args.keyframes,
      options: args.options,
    })

    return buildToolSuccess(
      'write_clip_keyframe',
      data,
      `已重写 ${data.itemId} 的 ${data.groupId} 通道。`,
    )
  } catch (error: any) {
    return buildToolError(
      'write_clip_keyframe',
      error?.toolCode ?? 'internal_error',
      error instanceof Error ? error.message : String(error),
      error?.toolDetails,
    )
  }
}

export const writeClipKeyframeTool: ToolDefinition = {
  name: 'write_clip_keyframe',
  execute: executeWriteClipKeyframe,
} as ToolDefinition
