import type { ToolDefinition } from '../core/toolTypes'
import { buildToolError, buildToolSuccess } from './utils/result'
import { getCurrentProjectInfo } from './projectInfoShared'

export async function executeReadProjectInfo(args: Record<string, any>) {
  try {
    void args
    const projectInfo = getCurrentProjectInfo()
    return buildToolSuccess('read_project_info', projectInfo)
  } catch (error: any) {
    return buildToolError(
      'read_project_info',
      'internal_error',
      error instanceof Error ? error.message : String(error),
    )
  }
}

export const readProjectInfoTool: ToolDefinition = {
  name: 'read_project_info',
  execute: executeReadProjectInfo,
} as ToolDefinition
