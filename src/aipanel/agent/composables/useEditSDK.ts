import { ScriptExecutor } from './executors/ScriptExecutor'
import { useBatchCommandBuilder } from './useBatchCommandBuilder'
import { ConfigValidator } from './core/ConfigValidator'
import { useUnifiedStore } from '@/core/unifiedStore'
import { countOverlappingItems } from '@/core/utils/timeOverlapUtils'

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
   * 根据ExecutionResult生成详细的执行报告，使用 markdown 格式
   */
  function generateExecutionReport(result: ExecutionResult): string {
    const lines: string[] = []

    // 标题
    lines.push(`# 音视频编辑执行结果`)
    lines.push('')
    lines.push(`**状态**: ${result.success ? '✅ 成功' : '❌ 失败'}`)
    lines.push('')

    // 操作数量信息
    if (result.operationCount !== undefined && result.operationCount > 0) {
      lines.push(`**操作数量**: ${result.operationCount}`)
      lines.push('')
    }

    // 脚本执行阶段 - 总是显示
    if (result.scriptExecutionError) {
      lines.push(`## ❌ 代码执行错误`)
      lines.push('')
      lines.push(`**错误消息**:`)
      lines.push('```')
      lines.push(result.scriptExecutionError)
      lines.push('```')

      // 添加堆栈信息
      if (result.scriptExecutionStack) {
        lines.push('')
        lines.push(`**错误堆栈**:`)
        lines.push('```')
        lines.push(result.scriptExecutionStack)
        lines.push('```')
      }
      lines.push('')
    }

    // 验证阶段 - 只有在没有脚本执行错误时才显示
    if (!result.scriptExecutionError) {
      if (result.validationErrors && result.validationErrors.length > 0) {
        lines.push(`## ❌ 验证失败`)
        lines.push('')
        result.validationErrors.forEach((error, index) => {
          lines.push(`### ${index + 1}. ${error.operation.type}`)
          lines.push('')
          lines.push(`- **错误**: ${error.error}`)
          lines.push('')
        })
      }
    }

    // 命令构建阶段 - 只有在没有脚本执行错误和验证错误时才显示
    if (
      !result.scriptExecutionError &&
      (!result.validationErrors || result.validationErrors.length === 0)
    ) {
      if (result.buildOperationErrors && result.buildOperationErrors.length > 0) {
        lines.push(`## ❌ 构建失败`)
        lines.push('')
        result.buildOperationErrors.forEach((error, index) => {
          lines.push(`### ${index + 1}. ${error.operation.type}`)
          lines.push('')

          // 错误消息
          if (error.error) {
            lines.push(`- **错误**: ${error.error}`)
          } else {
            lines.push(`- **错误**: 未知构建错误`)
          }

          // 堆栈信息
          if (error.stack) {
            lines.push(`- **堆栈**:`)
            lines.push('```')
            lines.push(error.stack)
            lines.push('```')
          }
          lines.push('')
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
        lines.push(`## ❌ 批量执行失败`)
        lines.push('')
        lines.push(`**错误**: ${result.batchExecutionError}`)
        lines.push('')
      }
    }

    // 日志信息 - 总是显示
    if (result.logs && result.logs.length > 0) {
      lines.push('---')
      lines.push('')
      lines.push(`## 执行日志`)
      lines.push('')
      result.logs.forEach((log) => {
        lines.push(`- \`[${log.type.toUpperCase()}]\` ${log.message}`)
      })
      lines.push('')
    }

    // 添加分隔线和提示信息
    lines.push('---')
    lines.push('')
    lines.push('> （提示：你已经调用了\'edit_sdk\'工具改动了环境，请使用相应读取工具检查你的执行结果）')

    // 检测片段重叠
    const overlappingCount = countOverlappingItems(unifiedStore.timelineItems)
    if (overlappingCount > 0) {
      lines.push('')
      lines.push(`> （警告：检测到 ${overlappingCount} 处片段重叠，建议使用时间轴读取工具查看并调整）`)
    }

    return lines.join('\n')
  }

  /**
   * 获取被动注入的上下文信息
   * 包括项目信息、选中状态和播放头位置，自动附加到用户消息中
   */
  function getPassiveContext(): string {
    const parts: string[] = []

    try {
      // 项目信息（直接从 unifiedStore 获取）
      const projectName = unifiedStore.projectName || '未命名项目'
      const videoResolution = unifiedStore.videoResolution
      const resolution = videoResolution
        ? `${videoResolution.width}x${videoResolution.height}${videoResolution.aspectRatio ? ` (${videoResolution.aspectRatio})` : ''}`
        : '未设置'

      parts.push(`[当前项目信息]`)
      parts.push(`- 项目名称: ${projectName}`)
      parts.push(`- 视频分辨率: ${resolution}`)
    } catch (error: any) {
      console.error('获取项目信息失败:', error)
      parts.push('[当前项目信息]')
      parts.push('- 项目信息获取失败')
    }

    // 选中状态信息
    try {
      const hasTimelineSelection = unifiedStore.hasSelection
      const hasMediaSelection = unifiedStore.hasMediaSelection

      if (hasTimelineSelection || hasMediaSelection) {
        parts.push('')
        parts.push('[当前选中状态]')

        // 时间轴项目选中信息
        if (hasTimelineSelection) {
          const selectedIds = Array.from(unifiedStore.selectedTimelineSelectionIds)
          const count = selectedIds.length

          if (count === 1) {
            const selectedItem = unifiedStore.getSelectedClipTimelineItem()
            const selectedTransition = unifiedStore.getSelectedTransitionOverlay()
            if (selectedItem) {
              parts.push(`- 时间轴选中: 1 个项目`)
              parts.push(`  - ID: ${selectedItem.id}`)
              parts.push(`  - 媒体类型: ${selectedItem.mediaType}`)
              if (selectedItem.trackId) {
                parts.push(`  - 轨道ID: ${selectedItem.trackId}`)
              }
              parts.push(`  - 时间范围: ${selectedItem.timeRange.timelineStartTime / 1000000}s - ${selectedItem.timeRange.timelineEndTime / 1000000}s`)
              if (selectedItem.mediaItemId) {
                parts.push(`  - 媒体项ID: ${selectedItem.mediaItemId}`)
              }
            } else if (selectedTransition) {
              parts.push(`- 时间轴选中: 1 个转场`)
              parts.push(`  - ID: ${selectedTransition.selectionId}`)
              parts.push(`  - 源片段ID: ${selectedTransition.sourceItemId}`)
              parts.push(`  - 轨道ID: ${selectedTransition.trackId}`)
            }
          } else {
            // 多选：只显示数量和ID列表
            parts.push(`- 时间轴选中: ${count} 个项目`)
            parts.push(`  - ID列表: ${selectedIds.join(', ')}`)
          }
        }

        // 媒体项目选中信息
        if (hasMediaSelection) {
          const selectedMediaIds = Array.from(unifiedStore.selectedMediaItemIds)
          const mediaCount = selectedMediaIds.length
          parts.push(`- 媒体库选中: ${mediaCount} 个项目`)
          if (mediaCount === 1) {
            const mediaId = selectedMediaIds[0]
            if (mediaId) {
              parts.push(`  - ID: ${mediaId}`)
              const mediaItem = unifiedStore.getMediaItem(mediaId)
              if (mediaItem) {
                parts.push(`  - 名称: ${mediaItem.name}`)
                parts.push(`  - 类型: ${mediaItem.mediaType}`)
              }
            }
          } else {
            parts.push(`  - ID列表: ${selectedMediaIds.join(', ')}`)
          }
        }
      }
    } catch (error: any) {
      console.error('获取选中状态失败:', error)
    }

    // 播放头位置信息
    try {
      const currentFrame = unifiedStore.currentFrame
      parts.push('')
      parts.push('[播放头位置]')
      parts.push(`- 当前帧: ${currentFrame}`)
    } catch (error: any) {
      console.error('获取播放头位置失败:', error)
    }

    return parts.join('\n')
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
    // 被动信息获取
    getPassiveContext,
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
