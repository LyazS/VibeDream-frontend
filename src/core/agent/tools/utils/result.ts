import type { ToolResult } from '../types'
import { isRecord } from '@/utils/typeGuards'

export function buildToolSuccess<T extends object>(
  tool: string,
  data: T,
  summary?: string,
): ToolResult {
  const payload = summary ? { tool, ...data, summary } : { tool, ...data }
  return {
    success: true,
    output: JSON.stringify(payload, null, 2),
  }
}

export function buildToolException(tool: string, error: unknown): ToolResult {
  const metadata = isRecord(error) ? error : {}
  return buildToolError(
    tool,
    typeof metadata.toolCode === 'string' ? metadata.toolCode : 'internal_error',
    error instanceof Error ? error.message : String(error),
    isRecord(metadata.toolDetails) ? metadata.toolDetails : undefined,
  )
}

export function buildToolError(
  tool: string,
  code: string,
  message: string,
  details?: Record<string, unknown>,
): ToolResult {
  return {
    success: false,
    output: JSON.stringify(
      { tool, error: message, code, ...(details ? { details } : {}) },
      null,
      2,
    ),
    error: message,
  }
}
