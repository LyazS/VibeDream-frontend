import type { ToolDefinition } from '../core/toolTypes'
import { KeyframeChannelEditService } from './keyframe-channel/KeyframeChannelEditService'

function formatKeyframeValue(value: unknown): string {
  return JSON.stringify(value)
}

function formatKeyframe(entry: { frame: number; value: unknown }): string {
  return `{ "frame": ${entry.frame}, "value": ${formatKeyframeValue(entry.value)} }`
}

function formatKeyframeSection(
  label: 'before' | 'after',
  entries: Array<{ frame: number; value: unknown }>,
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
  const service = new KeyframeChannelEditService()

  try {
    const data = await service.patchClipKeyframe({
      clipId: args.clipId,
      channelId: args.channelId,
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
  "channelId": "${data.channelId}",
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
