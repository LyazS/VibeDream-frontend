import type { ToolDefinition } from '../core/toolTypes'
import { KeyframePropertyEditService } from './keyframe-property/KeyframePropertyEditService'

function formatKeyframeValue(value: unknown): string {
  return JSON.stringify(value)
}

function formatKeyframe(entry: { time: string; value: unknown }): string {
  return `{ "time": ${JSON.stringify(entry.time)}, "value": ${formatKeyframeValue(entry.value)} }`
}

function formatKeyframeSection(
  label: 'before' | 'after',
  entries: Array<{ time: string; value: unknown }>,
  hasLeadingOmitted: boolean,
  hasTrailingOmitted: boolean,
): string {
  const lines = [`  "${label}": [`]

  if (hasLeadingOmitted) {
    lines.push('    ...')
  }

  for (const entry of entries) {
    lines.push(`    ${formatKeyframe(entry)},`)
  }

  if (hasTrailingOmitted) {
    lines.push('    ...')
  } else if (entries.length > 0) {
    const lastLine = lines[lines.length - 1]
    lines[lines.length - 1] = lastLine.endsWith(',') ? lastLine.slice(0, -1) : lastLine
  }

  lines.push('  ]')

  return lines.join('\n')
}

export async function executePatchClipKeyframe(args: Record<string, any>) {
  const service = new KeyframePropertyEditService()

  try {
    const data = await service.patchClipKeyframe({
      clipId: args.clipId,
      propertyId: args.propertyId,
      match: args.match,
      apply: args.apply,
    })

    const beforeSection = formatKeyframeSection(
      'before',
      data.before,
      data.beforeHasLeadingOmitted,
      data.beforeHasTrailingOmitted,
    )
    const afterSection = formatKeyframeSection(
      'after',
      data.after,
      data.afterHasLeadingOmitted,
      data.afterHasTrailingOmitted,
    )

    return {
      success: true,
      output: `{
  "tool": "patch_clip_keyframe",
  "clipId": "${data.clipId}",
  "propertyId": "${data.propertyId}",
${beforeSection},
${afterSection}
}`,
    }
  } catch (error: any) {
    const message = error instanceof Error ? error.message : String(error)
    return {
      success: false,
      output: JSON.stringify({ tool: 'patch_clip_keyframe', error: message }, null, 2),
      error: message,
    }
  }
}

export const patchClipKeyframeTool: ToolDefinition = {
  name: 'patch_clip_keyframe',
  execute: executePatchClipKeyframe,
} as ToolDefinition
