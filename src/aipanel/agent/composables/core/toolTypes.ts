/**
 * 工具执行类型定义
 * 在 useEditSDK 和工具实现之间共享
 */

export interface ToolExecutionContext {
  toolCallId?: string
}

export interface ToolErrorDetail {
  code: string
  message: string
  details?: Record<string, any>
}

export interface ToolSuccessEnvelope<T = Record<string, any>> {
  tool: string
  data: T
  summary?: string
}

export interface ToolErrorEnvelope {
  tool: string
  error: ToolErrorDetail
}

export type ToolOutputEnvelope<T = Record<string, any>> =
  | ToolSuccessEnvelope<T>
  | ToolErrorEnvelope

export interface ToolDefinition {
  name: string
  execute: (
    args: Record<string, any>,
    context?: ToolExecutionContext,
  ) => Promise<ToolOutputEnvelope>
}

export interface ToolResult {
  success: boolean
  output: string
  envelope?: ToolOutputEnvelope
  error?: string
}
