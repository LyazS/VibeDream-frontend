/**
 * 前端工具注册表
 * 负责工具的注册、查询和执行
 */

import { listContentsTool } from './listContents'
import { readMediaTool } from './readMedia'
import { listTracksTool } from './listTracks'
import { readTrackTool } from './readTrack'
import { readTimelineitemTool } from './readTimelineitem'
import { editSdkTool } from './editSdkTool'
import type { ToolDefinition, ToolResult } from '../core/toolTypes'

// 工具存储
const tools = new Map<string, ToolDefinition>()

/**
 * 注册工具（内部使用）
 */
function registerTool(tool: ToolDefinition): void {
  tools.set(tool.name, tool)
}

// 注册内置工具
registerTool(listContentsTool)
registerTool(readMediaTool)
registerTool(listTracksTool)
registerTool(readTrackTool)
registerTool(readTimelineitemTool)
registerTool(editSdkTool)

/**
 * 执行工具
 */
export function executeTool(name: string, args: Record<string, any>): Promise<ToolResult> {
  const tool = tools.get(name)
  if (!tool) {
    return Promise.resolve({
      success: false,
      result: '',
      error: `未找到工具: ${name}`,
    })
  }

  return tool.execute(args).then(
    (result) => ({ success: true, result }),
    (error) => ({
      success: false,
      result: '',
      error: error.message,
    })
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
export { listContentsTool, readMediaTool, listTracksTool, readTrackTool, readTimelineitemTool, editSdkTool }
export type { ToolDefinition, ToolResult }
