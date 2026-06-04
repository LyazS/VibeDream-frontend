/**
 * 工具执行类型定义
 * 在 useEditSDK 和工具实现之间共享
 */

export interface ToolExecutionContext {
  toolCallId?: string
}

export interface ToolDefinition {
  name: string
  execute: (args: Record<string, any>, context?: ToolExecutionContext) => Promise<string>
}

export interface ToolResult {
  success: boolean
  result: string
  error?: string
}
