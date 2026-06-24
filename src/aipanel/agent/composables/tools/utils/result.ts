import type {
  ToolErrorDetail,
  ToolErrorEnvelope,
  ToolOutputEnvelope,
  ToolSuccessEnvelope,
} from '../../core/toolTypes'

export function buildToolSuccess<T>(
  tool: string,
  data: T,
  summary?: string,
): ToolSuccessEnvelope<T> {
  return summary ? { tool, data, summary } : { tool, data }
}

export function buildToolError(
  tool: string,
  code: string,
  message: string,
  details?: Record<string, any>,
): ToolErrorEnvelope {
  const error: ToolErrorDetail = details ? { code, message, details } : { code, message }
  return { tool, error }
}

export function serializeToolOutput(envelope: ToolOutputEnvelope): string {
  return JSON.stringify(envelope, null, 2)
}

export function isToolErrorEnvelope(
  envelope: ToolOutputEnvelope,
): envelope is ToolErrorEnvelope {
  return 'error' in envelope
}
