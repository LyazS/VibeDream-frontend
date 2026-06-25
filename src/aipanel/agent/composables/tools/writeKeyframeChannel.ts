import type { ToolDefinition } from '../core/toolTypes'
import { buildToolError, buildToolSuccess } from './utils/result'
import { KeyframeChannelEditService } from './keyframe-channel/KeyframeChannelEditService'

export async function executeWriteKeyframeChannel(args: Record<string, any>) {
  const service = new KeyframeChannelEditService()

  try {
    const data = await service.writeKeyframeChannel({
      itemId: args.itemId,
      groupId: args.groupId,
      keyframes: args.keyframes,
      options: args.options,
    })

    return buildToolSuccess(
      'write_keyframe_channel',
      data,
      `已重写 ${data.itemId} 的 ${data.groupId} 通道。`,
    )
  } catch (error: any) {
    return buildToolError(
      'write_keyframe_channel',
      error?.toolCode ?? 'internal_error',
      error instanceof Error ? error.message : String(error),
      error?.toolDetails,
    )
  }
}

export const writeKeyframeChannelTool: ToolDefinition = {
  name: 'write_keyframe_channel',
  execute: executeWriteKeyframeChannel,
} as ToolDefinition
