import type { ToolDefinition } from '../core/toolTypes'
import { buildToolError, buildToolSuccess } from './utils/result'
import { KeyframeChannelEditService } from './keyframe-channel/KeyframeChannelEditService'

export async function executeDiffApplyKeyframeChannel(args: Record<string, any>) {
  const service = new KeyframeChannelEditService()

  try {
    const data = await service.diffApplyKeyframeChannel({
      itemId: args.itemId,
      groupId: args.groupId,
      match: args.match,
      apply: args.apply,
      options: args.options,
    })

    return buildToolSuccess(
      'diff_apply_keyframe_channel',
      data,
      `已局部更新 ${data.itemId} 的 ${data.groupId} 通道。`,
    )
  } catch (error: any) {
    return buildToolError(
      'diff_apply_keyframe_channel',
      error?.toolCode ?? 'internal_error',
      error instanceof Error ? error.message : String(error),
      error?.toolDetails,
    )
  }
}

export const diffApplyKeyframeChannelTool: ToolDefinition = {
  name: 'diff_apply_keyframe_channel',
  execute: executeDiffApplyKeyframeChannel,
} as ToolDefinition
