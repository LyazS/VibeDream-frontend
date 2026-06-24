/**
 * 前端工具注册表
 * 负责工具的注册、查询和执行
 */

import { addTrackTool } from './addTrack'
import { listMediaTool } from './listMedia'
import { listTracksTool } from './listTracks'
import { insertClipTool } from './insertClip'
import { moveClipTool } from './moveClip'
import { moveTrackTool } from './moveTrack'
import { patchClipPropertiesTool } from './patchClipProperties'
import { readClipTool } from './readClip'
import { readClipPropertiesTool } from './readClipProperties'
import { readMediaTool } from './readMedia'
import { readTrackTool } from './readTrack'
import { removeClipTool } from './removeClip'
import { removeTrackTool } from './removeTrack'
import { renameTrackTool } from './renameTrack'
import { searchMediaTool } from './searchMedia'
import { setTrackMuteTool } from './setTrackMute'
import { setTrackVisibilityTool } from './setTrackVisibility'
import { splitClipTool } from './splitClip'
import { trimClipTool } from './trimClip'
import type { ToolDefinition, ToolExecutionContext, ToolResult } from '../core/toolTypes'
import { isToolErrorEnvelope, serializeToolOutput } from './utils/result'

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
registerTool(addTrackTool)
registerTool(listMediaTool)
registerTool(listTracksTool)
registerTool(insertClipTool)
registerTool(moveClipTool)
registerTool(moveTrackTool)
registerTool(patchClipPropertiesTool)
registerTool(readClipTool)
registerTool(readClipPropertiesTool)
registerTool(readMediaTool)
registerTool(readTrackTool)
registerTool(removeClipTool)
registerTool(removeTrackTool)
registerTool(renameTrackTool)
registerTool(searchMediaTool)
registerTool(setTrackMuteTool)
registerTool(setTrackVisibilityTool)
registerTool(splitClipTool)
registerTool(trimClipTool)

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
      output: '',
      error: `未找到工具: ${name}`,
    })
  }

  return tool.execute(args, context).then(
    (envelope) => {
      const result = serializeToolOutput(envelope)
      const success = !isToolErrorEnvelope(envelope)
      logToolExecution({
        name,
        args,
        context,
        success,
        result,
        error: success ? undefined : envelope.error.message,
      })
      return {
        success,
        output: result,
        envelope,
        error: success ? undefined : envelope.error.message,
      }
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
        output: '',
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
  addTrackTool,
  listMediaTool,
  listTracksTool,
  insertClipTool,
  moveClipTool,
  moveTrackTool,
  patchClipPropertiesTool,
  readClipTool,
  readClipPropertiesTool,
  readMediaTool,
  readTrackTool,
  removeClipTool,
  removeTrackTool,
  renameTrackTool,
  searchMediaTool,
  setTrackMuteTool,
  setTrackVisibilityTool,
  splitClipTool,
  trimClipTool,
}
export type { ToolDefinition, ToolResult }
