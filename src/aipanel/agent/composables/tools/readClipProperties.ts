import type { ToolDefinition } from '../core/toolTypes'
import { buildToolError, buildToolSuccess } from './utils/result'
import { ClipPropertyEditService } from './clip-property/ClipPropertyEditService'

export async function executeReadClipProperties(args: Record<string, any>) {
  const service = new ClipPropertyEditService()

  try {
    const data = await service.readClipProperties({
      clipId: args.clipId,
      groupId: args.groupId,
    })

    return buildToolSuccess(
      'read_clip_properties',
      data,
      `已读取 ${data.clipId} 的 ${data.groupId} 属性。`,
    )
  } catch (error: any) {
    return buildToolError(
      'read_clip_properties',
      error?.toolCode ?? 'internal_error',
      error instanceof Error ? error.message : String(error),
      error?.toolDetails,
    )
  }
}

export const readClipPropertiesTool: ToolDefinition = {
  name: 'read_clip_properties',
  execute: executeReadClipProperties,
} as ToolDefinition
