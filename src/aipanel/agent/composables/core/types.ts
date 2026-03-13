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
 * 删除时间轴项目操作
 */
export interface RmTimelineItemOperation extends BaseOperationConfig {
  type: 'rmTimelineItem'
  params: {
    itemId: string // 要删除的时间轴项目 ID
  }
}

/**
 * 移动时间轴项目操作
 */
export interface MvTimelineItemOperation extends BaseOperationConfig {
  type: 'mvTimelineItem'
  params: {
    itemId: string // 要移动的时间轴项目 ID
    newPosition: string // 新位置（时间码格式 HH:MM:SS.FF）
    newTrackId?: string // 新轨道 ID（可选，不提供则保持在原轨道）
  }
}

/**
 * 调整时间轴项目大小操作
 */
export interface ResizeTimelineItemOperation extends BaseOperationConfig {
  type: 'resizeTimelineItem'
  params: {
    itemId: string // 要调整的时间轴项目 ID
    newStartTime?: string // 新时间轴开始时间（可选）
    newEndTime?: string // 新时间轴结束时间（可选）
    newClipStartTime?: string // 新裁剪开始时间（可选）
    newClipEndTime?: string // 新裁剪结束时间（可选）
  }
}

/**
 * 添加轨道操作
 */
export interface AddTrackOperation extends BaseOperationConfig {
  type: 'addTrack'
  params: {
    trackType: 'video' | 'audio' | 'image' // 轨道类型
    position?: number // 插入位置（可选，默认添加到末尾）
  }
}

/**
 * 删除轨道操作
 */
export interface RemoveTrackOperation extends BaseOperationConfig {
  type: 'removeTrack'
  params: {
    trackId: string // 要删除的轨道 ID
  }
}

/**
 * 重命名轨道操作
 */
export interface RenameTrackOperation extends BaseOperationConfig {
  type: 'renameTrack'
  params: {
    trackId: string // 要重命名的轨道 ID
    newName: string // 新名称
  }
}

/**
 * 切换轨道静音状态操作
 */
export interface ToggleTrackMuteOperation extends BaseOperationConfig {
  type: 'toggleTrackMute'
  params: {
    trackId: string // 轨道 ID
    targetMuteState?: boolean // 目标静音状态（可选，不提供则切换当前状态）
  }
}

/**
 * 切换轨道可见性操作
 */
export interface ToggleTrackVisibilityOperation extends BaseOperationConfig {
  type: 'toggleTrackVisibility'
  params: {
    trackId: string // 轨道 ID
    targetVisible?: boolean // 目标可见性（可选，不提供则切换当前状态）
  }
}

/**
 * 更新时间轴项目属性操作
 * 支持更新变换属性（位置、大小、旋转、透明度）和音频属性（音量、静音）
 */
export interface UpdateTimelineItemOperation extends BaseOperationConfig {
  type: 'updateTimelineItem'
  params: {
    itemId: string // 时间轴项目 ID
    // 视觉属性（可选）
    x?: number // X 位置
    y?: number // Y 位置
    width?: number // 宽度
    height?: number // 高度
    rotation?: number // 旋转角度（弧度）
    opacity?: number // 透明度 (0-1)
    proportionalScale?: boolean // 等比缩放状态
    // 音频属性（可选）
    volume?: number // 音量 (0-1)
    isMuted?: boolean // 静音状态
    // 扩展属性（可选）
    duration?: number // 时长（帧数）
    playbackRate?: number // 播放倍速
  }
}

/**
 * 操作配置联合类型 - 所有支持的操作类型
 */
export type OperationConfig =
  | AddTimelineItemOperation
  | RmTimelineItemOperation
  | MvTimelineItemOperation
  | ResizeTimelineItemOperation
  | UpdateTimelineItemOperation
  | AddTrackOperation
  | RemoveTrackOperation
  | RenameTrackOperation
  | ToggleTrackMuteOperation
  | ToggleTrackVisibilityOperation

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
