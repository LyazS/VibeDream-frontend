import type { MoneyString } from '@/utils/money'

/**
 * BizyAir 数据源类型定义
 * 集中管理所有 BizyAir 相关的类型、接口和枚举
 */

// ==================== 枚举定义 ====================

/**
 * BizyAir 任务状态枚举
 *
 * 对应 BizyAir API 返回的任务状态
 */
export enum BizyAirTaskStatus {
  QUEUING = 'Queuing', // 排队中
  PREPARING = 'Preparing', // 准备中
  RUNNING = 'Running', // 执行中
  SUCCESS = 'Success', // 成功
  FAILED = 'Failed', // 失败
  CANCELED = 'Canceled', // 已取消
}

// ==================== 核心接口定义 ====================

/**
 * BizyAir 数据源基础数据接口
 *
 * 继承自 BaseDataSourceData，添加 BizyAir 特定字段
 */
export interface BaseBizyAirSourceData {
  type: 'bizyair'
  bizyairTaskId: string // BizyAir API 返回的 request_id
  requestParams: BizyAirMediaGenerationRequest
  resultData?: BizyAirTaskResultData // 任务完成后的结果数据
  taskStatus: BizyAirTaskStatus // 任务状态（持久化）
}

/**
 * BizyAir 媒体生成请求接口
 *
 * 从 ai-generation 的 MediaGenerationRequest 派生，添加 BizyAir 特定字段
 */
export interface BizyAirMediaGenerationRequest {
  ai_task_type: string // 必须是 'bizyair_generate_media'
  content_type: string // 'image' | 'video' | 'audio'
  task_config: Record<string, any> // 任务配置
  sub_ai_task_type?: string // 子任务类型（可选），用于区分不同的 BizyAir 模型
}

/**
 * BizyAir 任务结果数据接口
 *
 * 存储 BizyAir 任务执行完成后的结果信息
 */
export interface BizyAirTaskResultData {
  /** 生成的媒体文件 URL */
  url: string
  /** BizyAir 任务 ID */
  bizyair_task_id?: string
}

// ==================== 配置相关接口 ====================

/**
 * BizyAir 应用配置接口
 *
 * 对应后端的 BizyAirAppConfig 模型
 */
export interface BizyAirAppConfig {
  /** 配置唯一标识符 */
  id: string
  /** 配置变体标识符 */
  variant: string
  /** BizyAir 应用 ID */
  web_app_id: number
  /** 应用名称 */
  name: string
  /** 应用描述 */
  description: string
  /** 媒体类型 */
  media_type: string
  /** 单次生成成本 */
  cost: MoneyString
  /** 输入映射 */
  input_mapping: Record<string, InputMappingItem | ArrayMappingItem | ArrayUrlMappingItem>
}

/**
 * 输入映射项接口
 *
 * 定义单个字段如何映射到 API 请求
 */
export interface InputMappingItem {
  /** 映射路径（支持嵌套，如 "121:CLIPTextEncode.text"） */
  mapping: string
  /** 字段类型 */
  type: string
  /** 默认值 */
  default?: any
  /** 验证规则 */
  validation?: {
    required?: boolean
    min?: number
    max?: number
    step?: number
    minLength?: number
    maxLength?: number
    description?: string
    computed?: boolean
    option?: string[]
    add_cost?: Record<string, MoneyString>
    add_real_cost?: Record<string, MoneyString>
  }
  /** 是否跳过 API 映射（不发送到后端） */
  skip_mapping?: boolean
}

/**
 * 数组类型参数映射配置
 * 
 * 对应后端的 ArrayMappingConfig
 */
export interface ArrayMappingItem {
  /** 参数类型，固定为 array */
  type: 'array'
  /** 数组元素配置列表 */
  items: InputMappingItem[]
}

/**
 * URL 数组类型参数映射配置
 * 
 * 对应后端的 ArrayUrlMappingConfig
 */
export interface ArrayUrlMappingItem {
  /** 映射路径 */
  mapping: string
  /** 参数类型，固定为 arrayurl */
  type: 'arrayurl'
  /** 默认值（URL 数组） */
  default?: string[]
  /** 验证规则 */
  validation?: {
    required?: boolean
    min?: number
    max?: number
    step?: number
    minLength?: number
    maxLength?: number
    description?: string
    computed?: boolean
    option?: string[]
    add_cost?: Record<string, MoneyString>
    add_real_cost?: Record<string, MoneyString>
  }
  /** URL 分隔符（默认为换行符） */
  separator?: string
}

/**
 * 配置选择器接口
 *
 * 用于根据任务配置选择合适的 BizyAir 配置
 */
export interface ConfigSelector {
  /**
   * 选择配置方法
   * @param taskConfig 任务配置
   * @returns BizyAir 应用配置
   */
  selectConfig(taskConfig: Record<string, any>): BizyAirAppConfig
}

/**
 * 请求构建器接口
 *
 * 用于构建 BizyAir API 请求数据
 */
export interface RequestBuilder {
  /**
   * 构建请求数据方法
   * @param taskConfig 任务配置
   * @param appConfig BizyAir 应用配置
   * @returns API 请求数据
   */
  buildRequestData(
    taskConfig: Record<string, any>,
    appConfig: BizyAirAppConfig
  ): Record<string, any>
}

// ==================== 任务详情接口 ====================

/**
 * BizyAir 任务详情接口
 *
 * 对应 BizyAir API 返回的任务详情数据
 */
export interface BizyAirTaskDetail {
  /** 任务 ID */
  request_id: string
  /** 任务状态 */
  status: BizyAirTaskStatus
  /** 排队信息（可选） */
  queueInfo?: {
    queue_count?: number
  }
  /** 进度信息（可选） */
  progress?: {
    /** 当前进度百分比 */
    percentage: number
    /** 当前阶段描述 */
    current_stage: string
    /** 预计剩余时间（秒，可选） */
    estimated_time?: number
  }
  /** 错误信息（失败时） */
  error?: {
    /** 错误代码 */
    code: string
    /** 错误消息 */
    message: string
  }
  /** 结果数据（成功时） */
  result?: {
    /** 输出文件 URL 列表 */
    outputs: Array<{
      /** 文件 URL */
      url: string
      /** 文件类型（可选） */
      type?: string
    }>
  }
}

// ==================== 进度回调类型 ====================

/**
 * 进度回调函数类型
 *
 * 用于在任务执行过程中报告进度
 */
export type ProgressCallback = (progress: {
  /** 当前进度百分比 (0-100) */
  percentage: number
  /** 当前阶段描述 */
  currentStage: string
  /** 任务状态 */
  status: BizyAirTaskStatus
}) => void

// ==================== API 响应类型 ====================

/**
 * BizyAir API 基础响应接口
 */
export interface BizyAirAPIResponse {
  /** 响应代码 */
  code: number
  /** 响应消息 */
  msg: string
}

/**
 * 提交任务响应接口
 * BizyAir API 直接返回 request_id，不包装在 data 层
 */
export interface SubmitTaskResponse {
  /** 任务 ID */
  request_id: string
}

/**
 * 查询任务详情响应接口
 */
export interface TaskDetailResponse extends BizyAirAPIResponse {
  /** 任务详情数据 */
  data: BizyAirTaskDetail
}

/**
 * 获取任务结果响应接口
 */
export interface TaskResultResponse extends BizyAirAPIResponse {
  /** 任务结果数据 */
  data: {
    /** 输出文件列表 */
    outputs: Array<{
      /** 文件 URL */
      object_url: string
      /** 文件类型（可选） */
      type?: string
    }>
  }
}
