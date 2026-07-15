/**
 * edit_sdk 工具实现
 * 执行视频编辑操作脚本
 */

import { useEditSDK } from '../useEditSDK'
import type { ToolDefinition } from '../core/toolTypes'
import { buildToolError, buildToolSuccess } from './utils/result'

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
export async function executeEditSDK(args: Record<string, any>) {
  const { script } = args

  try {
    if (!script || typeof script !== 'string') {
      return buildToolError(
        'edit_sdk',
        'invalid_arguments',
        'script 参数必须是有效的 JavaScript 代码字符串',
      )
    }

    const editSDK = useEditSDK()
    const result = await editSDK.executeUserScript(script)

    return buildToolSuccess(
      'edit_sdk',
      { result },
      '脚本执行完成。',
    )
  } catch (error: any) {
    return buildToolError(
      'edit_sdk',
      'internal_error',
      error instanceof Error ? error.message : String(error),
    )
  }
}

/**
 * edit_sdk 工具定义
 */
export const editSdkTool: ToolDefinition = {
  name: 'edit_sdk',
  execute: executeEditSDK,
} as ToolDefinition
