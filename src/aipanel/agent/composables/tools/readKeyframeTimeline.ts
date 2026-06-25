import type { ToolDefinition } from '../core/toolTypes'
import { buildToolError, buildToolSuccess } from './utils/result'
import { KeyframeChannelEditService } from './keyframe-channel/KeyframeChannelEditService'

export async function executeReadKeyframeTimeline(args: Record<string, any>) {
  const service = new KeyframeChannelEditService()

  try {
    const data = await service.readKeyframeTimeline({
      itemId: args.itemId,
      groupId: args.groupId,
    })

    return buildToolSuccess(
      'read_keyframe_timeline',
      data,
      `已读取 ${data.itemId} 的 ${data.groupId} 关键帧，共 ${data.keyframes.length} 个。`,
    )
  } catch (error: any) {
    return buildToolError(
      'read_keyframe_timeline',
      error?.toolCode ?? 'internal_error',
      error instanceof Error ? error.message : String(error),
      error?.toolDetails,
    )
  }
}

export const readKeyframeTimelineTool: ToolDefinition = {
  name: 'read_keyframe_timeline',
  execute: executeReadKeyframeTimeline,
} as ToolDefinition
