/**
 * 前端工具注册表
 * 负责工具的注册、查询和执行
 * 新 Agent 通过 ToolRuntime 复用这些执行器和原输出，不初始化旧会话编排。
 */

import { addTrackTool } from './addTrack'
import { createSubtitleClipTool } from './createSubtitleClip'
import { createFolderTool } from './createFolder'
import { deleteEmptyFolderTool } from './deleteEmptyFolder'
import { patchClipKeyframeTool } from './patchClipKeyframe'
import { listMediaTool } from './listMedia'
import { listTracksTool } from './listTracks'
import { modifyProjectInfoTool } from './modifyProjectInfo'
import { insertClipTool } from './insertClip'
import { inspectTimelineFramesTool } from './inspectTimelineFrames'
import { moveClipTool } from './moveClip'
import { moveLibraryItemsTool } from './moveLibraryItems'
import { moveTrackTool } from './moveTrack'
import { updateTrackPropertiesTool } from './updateTrackProperties'
import { readClipKeyframeTool } from './readClipKeyframe'
import { readMediaTool } from './readMedia'
import { renameLibraryItemTool } from './renameLibraryItem'
import { readProjectInfoTool } from './readProjectInfo'
import { readTracksTool } from './readTracks'
import { readItemTool } from './readItem'
import { updateItemTool } from './updateItem'
import { applyTransitionTool, removeItemTool, searchTransitionsTool } from './transitionTools'
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
  args: Record<string, unknown>
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
registerTool(createFolderTool)
registerTool(deleteEmptyFolderTool)
registerTool(patchClipKeyframeTool)
registerTool(listMediaTool)
registerTool(listTracksTool)
registerTool(readProjectInfoTool)
registerTool(modifyProjectInfoTool)
registerTool(insertClipTool)
registerTool(inspectTimelineFramesTool)
registerTool(moveClipTool)
registerTool(moveLibraryItemsTool)
registerTool(moveTrackTool)
registerTool(updateTrackPropertiesTool)
registerTool(readClipKeyframeTool)
registerTool(readMediaTool)
registerTool(renameLibraryItemTool)
registerTool(readTracksTool)
registerTool(readItemTool)
registerTool(updateItemTool)
registerTool(searchTransitionsTool)
registerTool(applyTransitionTool)
registerTool(removeItemTool)
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
  args: Record<string, unknown>,
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
  createFolderTool,
  deleteEmptyFolderTool,
  patchClipKeyframeTool,
  listMediaTool,
  listTracksTool,
  readProjectInfoTool,
  modifyProjectInfoTool,
  insertClipTool,
  inspectTimelineFramesTool,
  moveClipTool,
  moveLibraryItemsTool,
  moveTrackTool,
  updateTrackPropertiesTool,
  readClipKeyframeTool,
  readMediaTool,
  renameLibraryItemTool,
  readTracksTool,
  readItemTool,
  updateItemTool,
  searchTransitionsTool,
  applyTransitionTool,
  removeItemTool,
  removeTrackTool,
  searchMediaTool,
  splitClipTool,
  trimClipTool,
  writeClipKeyframeTool,
}
export type { ToolDefinition, ToolResult }
