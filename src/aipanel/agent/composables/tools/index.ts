/**
 * 前端工具注册表
 * 负责工具的注册、查询和执行
 */

import { addTrackTool } from './addTrack'
import { createSubtitleClipTool } from './createSubtitleClip'
import { patchClipKeyframeTool } from './patchClipKeyframe'
import { listMediaTool } from './listMedia'
import { listTracksTool } from './listTracks'
import { insertClipTool } from './insertClip'
import { moveClipTool } from './moveClip'
import { moveTrackTool } from './moveTrack'
import { updateClipPropertiesTool } from './updateClipProperties'
import { updateTrackPropertiesTool } from './updateTrackProperties'
import { readClipPropertiesTool } from './readClipProperties'
import { readClipKeyframeTool } from './readClipKeyframe'
import { readMediaTool } from './readMedia'
import { readTrackTool } from './readTrack'
import { removeClipTool } from './removeClip'
import { removeTrackTool } from './removeTrack'
import { searchMediaTool } from './searchMedia'
import { splitClipTool } from './splitClip'
import { trimClipTool } from './trimClip'
import { writeClipKeyframeTool } from './writeClipKeyframe'
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
registerTool(addTrackTool)
registerTool(createSubtitleClipTool)
registerTool(patchClipKeyframeTool)
registerTool(listMediaTool)
registerTool(listTracksTool)
registerTool(insertClipTool)
registerTool(moveClipTool)
registerTool(moveTrackTool)
registerTool(updateClipPropertiesTool)
registerTool(updateTrackPropertiesTool)
registerTool(readClipPropertiesTool)
registerTool(readClipKeyframeTool)
registerTool(readMediaTool)
registerTool(readTrackTool)
registerTool(removeClipTool)
registerTool(removeTrackTool)
registerTool(searchMediaTool)
registerTool(splitClipTool)
registerTool(trimClipTool)
registerTool(writeClipKeyframeTool)

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
    (result) => {
      logToolExecution({
        name,
        args,
        context,
        success: result.success,
        result: result.output,
        error: result.success ? undefined : result.error,
      })
      return result
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
  createSubtitleClipTool,
  patchClipKeyframeTool,
  listMediaTool,
  listTracksTool,
  insertClipTool,
  moveClipTool,
  moveTrackTool,
  updateClipPropertiesTool,
  updateTrackPropertiesTool,
  readClipPropertiesTool,
  readClipKeyframeTool,
  readMediaTool,
  readTrackTool,
  removeClipTool,
  removeTrackTool,
  searchMediaTool,
  splitClipTool,
  trimClipTool,
  writeClipKeyframeTool,
}
export type { ToolDefinition, ToolResult }
