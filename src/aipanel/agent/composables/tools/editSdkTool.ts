/**
 * edit_sdk 工具实现
 * 执行视频编辑操作脚本
 */

import { useEditSDK } from '../useEditSDK'
import type { ToolDefinition } from '../core/toolTypes'

/**
 * edit_sdk 工具执行函数
 *
 * 执行视频编辑操作脚本。Agent 通过编写 JavaScript 代码调用编辑 SDK，
 * 实现对时间轴、轨道、素材的增删改操作。
 *
 * MVP 阶段：支持 addTimelineItem 操作
 *
 * @param args - 工具参数
 * @param args.script - 要执行的 JavaScript 代码
 * @returns 执行结果报告
 */
export async function executeEditSDK(args: Record<string, any>): Promise<string> {
  const { script } = args

  try {
    // 参数验证
    if (!script || typeof script !== 'string') {
      return '错误: script 参数必须是有效的 JavaScript 代码字符串'
    }

    // 执行脚本
    const editSDK = useEditSDK()
    const result = await editSDK.executeUserScript(script)

    return result
  } catch (error: any) {
    return `执行错误: ${error.message}`
  }
}

/**
 * edit_sdk 工具定义
 */
export const editSdkTool: ToolDefinition = {
  name: 'edit_sdk',
  execute: executeEditSDK,
} as ToolDefinition
