/**
 * 工具执行类型定义
 * 在 useEditSDK 和工具实现之间共享
 */

export interface ToolDefinition {
  name: string
  execute: (args: Record<string, any>) => Promise<string>
}

export interface ToolResult {
  success: boolean
  result: string
  error?: string
}
