/**
 * 前端工具注册表
 * 负责工具的注册、查询和执行
 */

import { listMediaTool } from './listMedia'
import { listTracksTool } from './listTracks'
import { readClipTool } from './readClip'
import { readMediaTool } from './readMedia'
import { readTrackTool } from './readTrack'
import { searchMediaTool } from './searchMedia'
import type { ToolDefinition, ToolExecutionContext, ToolResult } from '../core/toolTypes'

// 工具存储
const tools = new Map<string, ToolDefinition>()

function logToolExecution(params: {
  name: string
  args: Record<string, any>
  context?: ToolExecutionContext
  success: boolean
  result?: string
  error?: string
}): void {
  const { name, args, context, success, result, error } = params
  const lines = [
    `[AgentTool] ${success ? 'execution result' : 'execution failed'}`,
    `tool: ${name}`,
    `toolCallId: ${context?.toolCallId ?? ''}`,
    `success: ${success}`,
    `args: ${JSON.stringify(args, null, 2)}`,
  ]

  if (result !== undefined) {
    lines.push(`result:\n${result}`)
  }

  if (error !== undefined) {
    lines.push(`error: ${error}`)
  }

  const message = lines.join('\n')

  if (success) {
    console.log(message)
    return
  }

  console.error(message)
}

/**
 * 注册工具（内部使用）
 */
function registerTool(tool: ToolDefinition): void {
  tools.set(tool.name, tool)
}

// 注册内置工具
registerTool(listMediaTool)
registerTool(listTracksTool)
registerTool(readClipTool)
registerTool(readMediaTool)
registerTool(readTrackTool)
registerTool(searchMediaTool)

/**
 * 执行工具
 */
export function executeTool(
  name: string,
  args: Record<string, any>,
  context?: ToolExecutionContext,
): Promise<ToolResult> {
  const tool = tools.get(name)
  if (!tool) {
    logToolExecution({
      name,
      args,
      context,
      success: false,
      error: `未找到工具: ${name}`,
    })
    return Promise.resolve({
      success: false,
      result: '',
      error: `未找到工具: ${name}`,
    })
  }

  return tool.execute(args, context).then(
    (result) => {
      logToolExecution({
        name,
        args,
        context,
        success: true,
        result,
      })
      return { success: true, result }
    },
    (error) => {
      logToolExecution({
        name,
        args,
        context,
        success: false,
        error: error.message,
      })
      return {
        success: false,
        result: '',
        error: error.message,
      }
    },
  )
}

/**
 * 检查工具是否存在
 */
export function hasTool(name: string): boolean {
  return tools.has(name)
}

/**
 * 获取工具定义
 */
export function getTool(name: string): ToolDefinition | undefined {
  return tools.get(name)
}

/**
 * 列出所有工具
 */
export function listTools(): ToolDefinition[] {
  return Array.from(tools.values())
}

// 导出工具定义供外部参考
export {
  listMediaTool,
  listTracksTool,
  readClipTool,
  readMediaTool,
  readTrackTool,
  searchMediaTool,
}
export type { ToolDefinition, ToolResult }
