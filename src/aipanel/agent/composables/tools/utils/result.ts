import type { ToolResult } from '../../core/toolTypes'

export function buildToolSuccess<T extends Record<string, any>>(
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

export function buildToolError(
  tool: string,
  code: string,
  message: string,
  details?: Record<string, any>,
): ToolResult {
  void code
  void details
  return {
    success: false,
    output: JSON.stringify({ tool, error: message }, null, 2),
    error: message,
  }
}
