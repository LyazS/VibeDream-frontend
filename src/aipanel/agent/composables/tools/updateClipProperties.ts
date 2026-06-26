import type { ToolDefinition } from '../core/toolTypes'
import { buildToolError, buildToolSuccess } from './utils/result'
import { ClipPropertyEditService } from './clip-property/ClipPropertyEditService'

export async function executeUpdateClipProperties(args: Record<string, any>) {
  const service = new ClipPropertyEditService()

  try {
    const data = await service.updateClipProperties({
      clipId: args.clipId,
      match: args.match,
      patch: args.patch,
    })

    return buildToolSuccess(
      'update_clip_properties',
      data,
      `已更新 ${data.clipId} 的 ${Object.keys(data.after).length} 个属性。`,
    )
  } catch (error: any) {
    return buildToolError(
      'update_clip_properties',
      error?.toolCode ?? 'internal_error',
      error instanceof Error ? error.message : String(error),
      error?.toolDetails,
    )
  }
}

export const updateClipPropertiesTool: ToolDefinition = {
  name: 'update_clip_properties',
  execute: executeUpdateClipProperties,
} as ToolDefinition
