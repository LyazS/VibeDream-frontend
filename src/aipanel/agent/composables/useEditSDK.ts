import { ScriptExecutor } from './executors/ScriptExecutor'
import { useBatchCommandBuilder } from './useBatchCommandBuilder'
import { ConfigValidator } from './core/ConfigValidator'
import { useUnifiedStore } from '@/core/unifiedStore'

// 导入共享类型定义
import type {
  BuildResult,
  BuildOperationResult,
  ExecutionResult,
  LogMessage,
  ValidationError,
  ScriptExecutionResult,
} from './core/types'

// 导入工具管理
import * as tools from './tools'

type EditSDKReturn = ReturnType<typeof createEditSDK>

// 单例缓存
let editSDKCache: EditSDKReturn | null = null


/**
 * 创建音视频编辑SDK实例
 *
 * 提供完整的三阶段执行流程协调功能
 */
function createEditSDK() {
  // 使用统一存储
  const unifiedStore = useUnifiedStore()

  // 创建批量命令构建器
  const batchCommandBuilder = useBatchCommandBuilder()

  // 创建配置验证器
  const configValidator = new ConfigValidator()

  /**
   * 执行用户脚本 - 核心执行函数
   *
   * 协调音视频编辑四阶段执行流程：
   * 1. 脚本执行 → 2. 配置验证 → 3. 命令构建 → 4. 批量执行
   */
  async function executeUserScript(userScript: string, timeout: number = 5000): Promise<string> {
    let allLogs: LogMessage[] = []
    let scriptExecutionError: string | undefined = undefined
    let validationErrors: ValidationError[] | undefined = undefined
    let buildOperationErrors: BuildOperationResult[] | undefined = undefined
    let batchExecutionError: string | undefined = undefined

    try {
      // 阶段1: 脚本执行
      const result = await executeScriptPhase(userScript, timeout)
      const { operations, logs, error } = result
      allLogs = logs || []
      scriptExecutionError = error

      if (!operations || operations.length === 0) {
        const executionResult: ExecutionResult = {
          success: !scriptExecutionError,
          operationCount: 0,
          logs: allLogs,
          scriptExecutionError,
        }
        return generateExecutionReport(executionResult)
      }

      // 阶段2: 配置验证
      validationErrors = configValidator.validateOperations(operations)
      if (validationErrors.length > 0) {
        const executionResult: ExecutionResult = {
          success: false,
          logs: allLogs,
          scriptExecutionError,
          validationErrors,
        }
        return generateExecutionReport(executionResult)
      }

      // 阶段3: 命令构建
      const buildResult = await batchCommandBuilder.buildOperations(operations)

      if (buildResult.buildResults.some((r: BuildOperationResult) => !r.success)) {
        buildOperationErrors = buildResult.buildResults.filter((r: BuildOperationResult) => !r.success)
        const executionResult: ExecutionResult = {
          success: false,
          logs: allLogs,
          scriptExecutionError,
          validationErrors,
          buildOperationErrors,
        }
        return generateExecutionReport(executionResult)
      }

      // 阶段4: 批量执行
      const executionResult = await executeCommandsPhase(buildResult)
      if (executionResult) {
        batchExecutionError = executionResult
        const executionResultObj: ExecutionResult = {
          success: false,
          logs: allLogs,
          scriptExecutionError,
          validationErrors,
          buildOperationErrors,
          batchExecutionError,
        }
        return generateExecutionReport(executionResultObj)
      }

      const finalResult: ExecutionResult = {
        success: true,
        operationCount: operations.length,
      }
      return generateExecutionReport(finalResult)
    } catch (error: any) {
      const executionResult: ExecutionResult = {
        success: false,
        logs: allLogs,
        scriptExecutionError,
        validationErrors,
        buildOperationErrors,
        batchExecutionError,
      }
      return generateExecutionReport(executionResult)
    }
  }

  /**
   * 阶段1: 脚本执行
   *
   * 在沙箱环境中执行用户代码，生成音视频编辑操作配置
   */
  async function executeScriptPhase(
    userScript: string,
    timeout: number,
  ): Promise<ScriptExecutionResult> {
    // 每次执行时创建新的ScriptExecutor实例
    const scriptExecutor = new ScriptExecutor()
    const result = await scriptExecutor.executeScript(userScript, timeout)
    // 确保资源被清理
    scriptExecutor.destroy()
    return result
  }

  /**
   * 阶段3: 批量执行
   *
   * 执行构建好的音视频编辑批量命令
   */
  async function executeCommandsPhase(buildResult: BuildResult): Promise<string | null> {
    try {
      // 执行批量命令
      await buildResult.batchCommand.execute()

      // 创建成功结果
      return null
    } catch (error: any) {
      // 批量执行失败
      return error.message
    }
  }

  /**
   * 生成执行结果报告
   *
   * 根据ExecutionResult生成详细的执行报告，根据错误字段的递进关系决定显示哪些阶段
   */
  function generateExecutionReport(result: ExecutionResult): string {
    const lines: string[] = []

    // 标题
    lines.push(`音视频编辑: ${result.success ? '✅ 成功' : '❌ 失败'}`)
    lines.push('')

    // 操作数量信息
    if (result.operationCount !== undefined && result.operationCount > 0) {
      lines.push(`操作数量: ${result.operationCount}`)
    }

    // 脚本执行阶段 - 总是显示
    if (result.scriptExecutionError) {
      lines.push(`❌ 代码执行报错:`)
      lines.push(result.scriptExecutionError)
    }

    // 验证阶段 - 只有在没有脚本执行错误时才显示
    if (!result.scriptExecutionError) {
      if (result.validationErrors && result.validationErrors.length > 0) {
        lines.push(`❌ 验证失败 (${result.validationErrors.length} 个错误):`)
        result.validationErrors.forEach((error, index) => {
          lines.push(`  ${index + 1}. 操作类型: ${error.operation.type}`)
          lines.push(`     错误: ${error.error}`)
        })
      }
    }

    // 命令构建阶段 - 只有在没有脚本执行错误和验证错误时才显示
    if (
      !result.scriptExecutionError &&
      (!result.validationErrors || result.validationErrors.length === 0)
    ) {
      if (result.buildOperationErrors && result.buildOperationErrors.length > 0) {
        lines.push(`❌ 构建失败 (${result.buildOperationErrors.length} 个错误):`)
        result.buildOperationErrors.forEach((error, index) => {
          lines.push(`  ${index + 1}. 操作类型: ${error.operation.type}`)
          if (error.error) {
            lines.push(`     错误: ${error.error}`)
          }
        })
      }
    }

    // 批量执行阶段 - 只有在没有前面阶段的错误时才显示
    if (
      !result.scriptExecutionError &&
      (!result.validationErrors || result.validationErrors.length === 0) &&
      (!result.buildOperationErrors || result.buildOperationErrors.length === 0)
    ) {
      if (result.batchExecutionError) {
        lines.push(`❌ 执行失败: ${result.batchExecutionError}`)
      }
    }

    // 日志信息 - 总是显示
    if (result.logs && result.logs.length > 0) {
      lines.push('')
      lines.push('--- 代码执行日志 ---')
      result.logs.forEach((log, index) => {
        lines.push(`[${log.type.toUpperCase()}] ${log.message}`)
      })
    }

    return lines.join('\n')
  }


  // 返回组合式API接口
  return {
    // 核心函数
    executeUserScript,
    // 工具管理（从 tools 模块导入）
    executeTool: tools.executeTool,
    hasTool: tools.hasTool,
    getTool: tools.getTool,
    listTools: tools.listTools,
  }
}

/**
 * 音视频编辑SDK组合式函数（单例模式）
 *
 * 提供完整的三阶段执行流程协调功能
 * 使用单例缓存确保整个应用共享同一个实例
 */
export function useEditSDK() {
  if (!editSDKCache) {
    editSDKCache = createEditSDK()
  }
  return editSDKCache
}
