/**
 * 代理系统共享类型定义
 * 统一管理所有代理相关的类型定义，避免重复定义
 */
import type { BaseBatchCommand } from '@/core/modules/UnifiedHistoryModule'

/**
 * 基础操作配置接口
 */
export interface BaseOperationConfig {
  type: string
  params: any
}

/**
 * 添加时间轴项目操作
 */
export interface AddTimelineItemOperation extends BaseOperationConfig {
  type: 'addTimelineItem'
  params: {
    mediaItemId: string
    trackId: string
    position: string // 时间轴位置（时间码）
  }
}

/**
 * 操作配置联合类型 - 所有支持的操作类型
 */
export type OperationConfig = AddTimelineItemOperation

/**
 * 验证错误接口
 */
export interface ValidationError {
  operation: BaseOperationConfig
  error: string
}

/**
 * 操作结果接口
 */
export interface BuildOperationResult {
  success: boolean
  operation: OperationConfig
  error?: string
}

/**
 * 构建结果接口
 */
export interface BuildResult {
  batchCommand: BaseBatchCommand
  buildResults: BuildOperationResult[]
}

/**
 * 日志消息接口
 */
export interface LogMessage {
  type: 'log' | 'info' | 'warn' | 'error' | 'debug'
  message: string
}

/**
 * 执行结果接口
 */
export interface ExecutionResult {
  success: boolean
  operationCount?: number // 操作数量
  logs?: LogMessage[] // 脚本执行的调试打印日志
  scriptExecutionError?: string // 脚本执行阶段的详细错误信息
  validationErrors?: ValidationError[] // 验证阶段的错误信息
  buildOperationErrors?: BuildOperationResult[] // 构建阶段的错误信息
  batchExecutionError?: string // 批量命令执行阶段的错误信息
  error?: string // 执行期间的错误
}

/**
 * 脚本执行结果接口（包含完整执行信息）
 */
export interface ScriptExecutionResult {
  success: boolean
  operations?: OperationConfig[]
  error?: string
  stack?: string
  logs?: LogMessage[]
}
