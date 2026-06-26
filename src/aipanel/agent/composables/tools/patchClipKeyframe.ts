import type { ToolDefinition } from '../core/toolTypes'
import { buildToolError, buildToolSuccess } from './utils/result'
import { KeyframeChannelEditService } from './keyframe-channel/KeyframeChannelEditService'

export async function executePatchClipKeyframe(args: Record<string, any>) {
  const service = new KeyframeChannelEditService()

  try {
    const data = await service.patchClipKeyframe({
      itemId: args.itemId,
      groupId: args.groupId,
      range: args.range,
      match: args.match,
      apply: args.apply,
      options: args.options,
    })

    return buildToolSuccess(
      'patch_clip_keyframe',
      data,
      `已局部更新 ${data.itemId} 的 ${data.groupId} 通道。`,
    )
  } catch (error: any) {
    return buildToolError(
      'patch_clip_keyframe',
      error?.toolCode ?? 'internal_error',
      error instanceof Error ? error.message : String(error),
      error?.toolDetails,
    )
  }
}

export const patchClipKeyframeTool: ToolDefinition = {
  name: 'patch_clip_keyframe',
  execute: executePatchClipKeyframe,
} as ToolDefinition
