import type { MoneyString } from '@/utils/money'

/**
 * AI生成数据源类型定义
 * 集中管理所有AI生成相关的类型、接口和枚举
 */

// ==================== 枚举定义 ====================

/**
 * 字段类型枚举
 */
export enum FieldType {
  STRING = 'string',
  NUMBER = 'number',
  ARRAY = 'array',
  BOOLEAN = 'boolean',
  OBJECT = 'object',
  SORA2PROMPT = 'sora2prompt', // Sora2 提示词类型，支持标签转换
}

/**
 * AI任务类型枚举
 */
export enum AITaskType {
  TEXT_TO_IMAGE = 'text_to_image',
  REMOTE_IMAGE = 'remote_image',
  BIZYAIR_GENERATE_MEDIA = 'bizyair_generate_media',
  RUNNINGHUB_GENERATE_MEDIA = 'runninghub_generate_media', // RunningHub 媒体生成
}

/**
 * 内容类型枚举
 */
export enum ContentType {
  IMAGE = 'image',
  VIDEO = 'video',
  AUDIO = 'audio',
}

/**
 * 任务状态枚举
 */
export enum TaskStatus {
  PENDING = 'PENDING',
  PROCESSING = 'PROCESSING',
  COMPLETED = 'COMPLETED',
  FAILED = 'FAILED',
  CANCELLED = 'CANCELLED',
}

/**
 * 流事件类型枚举
 */
export enum TaskStreamEventType {
  PROGRESS_UPDATE = 'progress_update',
  NOT_FOUND = 'not_found',
  ERROR = 'error',
  FINAL = 'final',
  HEARTBEAT = 'heartbeat',
}

// ==================== 请求和配置接口 ====================

/**
 * 媒体生成请求接口（3字段结构）
 */
export interface MediaGenerationRequest {
  ai_task_type: AITaskType
  content_type: ContentType
  task_config: Record<string, any>
  sub_ai_task_type?: string // 子任务类型（可选），用于区分同一服务提供商的不同API类型
}

/**
 * 任务结果数据接口
 *
 * 存储任务执行完成后的结果信息，包含生成的媒体文件 URL。
 * 对应后端的 TaskResultData 模型。
 */
export interface TaskResultData {
  /** 生成的媒体文件 URL */
  url: string
}

/**
 * 文生图任务配置
 */
export interface TextToImageConfig {
  text: string
  width?: number
  height?: number
  style?: string
  quality?: string
  format?: string
}

// ==================== 流事件接口 ====================

/**
 * 流事件基础接口
 */
interface BaseTaskStreamEvent {
  task_id: string
  timestamp: string
}

/**
 * 进度更新事件
 */
export interface ProgressUpdateEvent extends BaseTaskStreamEvent {
  type: TaskStreamEventType.PROGRESS_UPDATE
  status: TaskStatus
  progress: number
  message: string
  metadata?: Record<string, any>
}

/**
 * 最终事件（任务完成/失败/取消）
 */
export interface FinalEvent extends BaseTaskStreamEvent {
  type: TaskStreamEventType.FINAL
  status: TaskStatus
  progress: number
  message: string
  result_data?: TaskResultData // 任务结果数据（仅完成时有值）
}

/**
 * 错误事件（系统错误，不是任务失败）
 */
export interface ErrorEvent extends BaseTaskStreamEvent {
  type: TaskStreamEventType.ERROR
  message: string
}

/**
 * 任务不存在，那就是错误
 */
export interface NotFoundEvent extends BaseTaskStreamEvent {
  type: TaskStreamEventType.NOT_FOUND
  message: string
}

/**
 * 心跳事件
 */
export interface HeartbeatEvent extends BaseTaskStreamEvent {
  type: TaskStreamEventType.HEARTBEAT
  message: string
}

/**
 * 流事件联合类型
 */
export type TaskStreamEvent =
  | ProgressUpdateEvent
  | NotFoundEvent
  | FinalEvent
  | ErrorEvent
  | HeartbeatEvent

// ==================== 执行阶段相关类型 ====================

/**
 * 媒体类型信息接口
 */
export interface MediaTypeInfo {
  mimeType: string
  extension: string
}

/**
 * 文件准备结果类型
 */
export type PrepareFileResult =
  | {
      success: true
      file: File
      mediaType: 'image' | 'video' | 'audio' | null
      needSaveMeta: boolean // 是否需要保存 meta 文件
      needSaveMedia: boolean // 是否需要保存媒体文件
    }
  | {
      success: false
      error: string
      needSaveMeta: boolean // 失败时也需要保存 meta（持久化失败状态）
    }

// ==================== AI 生成配置类型 ====================

/**
 * 多语言文本类型
 */
export interface I18nText {
  en: string
  zh: string
}

/**
 * UI 配置项基础类型
 */
export interface BaseUIConfig {
  type: string
  label: I18nText
  path: string
  required?: boolean // 是否必填
  placeholder?: I18nText
}

/**
 * 数字输入配置
 */
export interface NumberInputConfig extends BaseUIConfig {
  type: 'number-input'
  min: number
  max: number
  step: number
  precision: number
  showSlider?: boolean // 是否显示滑块，默认为 true
}

/**
 * 文本域输入配置
 */
export interface TextareaInputConfig extends BaseUIConfig {
  type: 'textarea-input'
  maxLength?: number // 最大长度限制
  minLength?: number // 最小长度限制
  enableTag?: boolean // 是否启用标签功能（TagInput），默认为 false
}

/**
 * 选择输入配置
 */
export interface SelectInputConfig extends BaseUIConfig {
  type: 'select-input'
  options: Array<{
    label: I18nText
    value: string | number
    add_cost?: MoneyString // 可选的额外成本字段
  }>
}

/**
 * 文件输入配置
 */
export interface FileInputConfig extends BaseUIConfig {
  type: 'file-input'
  accept?: string[] // 接受的文件类型，如 ['image', 'video']
  placeholder?: I18nText // 占位符文本
  maxFiles?: number // 最大文件数量，默认为 1
  minFiles?: number // 最小文件数量，默认为 0
}

/**
 * 文件数据接口
 */
export interface FileData {
  // 类型标识符，用于运行时类型检查
  readonly __type__: 'FileData'

  name: string
  mediaType: 'video' | 'image' | 'audio'
  mediaItemId?: string
  timelineItemId?: string
  duration?: number
  resolution?: {
    width: number
    height: number
  }
  timeRange?: {
    clipStartTime: number
    clipEndTime: number
    timelineStartTime: number
    timelineEndTime: number
  }
  source: 'media-item' | 'timeline-item'
}

/**
 * 多文件数据类型（数组形式）
 */
export type MultiFileData = FileData[]

/**
 * 文件项状态枚举
 */
export enum FileItemStatus {
  EMPTY = 'empty', // 空槽位（显示上传框）
  FILLED = 'filled', // 已填充文件
}

/**
 * 文件槽位接口
 */
export interface FileSlot {
  index: number
  status: FileItemStatus
  fileData: FileData | null
  isDragOver: boolean
  canAcceptDrop: boolean
}

// ==================== 验证相关类型 ====================

/**
 * 验证错误类型枚举
 */
export enum ValidationErrorType {
  REQUIRED = 'required', // 必填字段为空
  MIN_LENGTH = 'minLength', // 文本长度不足
  MAX_LENGTH = 'maxLength', // 文本长度超限
  MIN_FILES = 'minFiles', // 文件数量不足
  MAX_FILES = 'maxFiles', // 文件数量超限
  MIN_VALUE = 'minValue', // 数值小于最小值
  MAX_VALUE = 'maxValue', // 数值大于最大值
  INVALID_FORMAT = 'invalidFormat', // 格式不正确
}

/**
 * 单个字段的验证错误
 */
export interface FieldValidationError {
  path: string // 字段路径，如 'aiConfig.prompt'
  fieldLabel: I18nText // 字段标签
  errorType: ValidationErrorType
  message: I18nText // 错误消息
}

/**
 * 完整的验证结果
 */
export interface ValidationResult {
  isValid: boolean // 是否通过验证
  errors: FieldValidationError[] // 错误列表
  errorsByPath: Map<string, FieldValidationError> // 按路径索引的错误
}

/**
 * UI 配置项联合类型
 */
export type UIConfig = NumberInputConfig | TextareaInputConfig | SelectInputConfig | FileInputConfig

/**
 * 上传服务器类型
 */
export type UploadServerType = 'bizyair' | 'runninghub' | 'runninghubstd'

/**
 * AI 生成配置结构
 */
export interface AIGenerateConfig {
  id: string // 配置唯一标识符
  name: I18nText
  description: I18nText
  contentType: ContentType
  aiTaskType: AITaskType
  uploadServer?: UploadServerType // 上传服务器类型，默认为 'default'
  subAiTaskType?: string // 子任务类型（可选），用于区分同一服务提供商的不同API类型
  cost: MoneyString // 生成成本
  aiConfig: AIConfigWithWrapper // 使用包装器结构
  uiConfig: UIConfig[]
}

// ==================== 包装器结构类型 ====================

/**
 * 字段包装器类型
 * 用于 aiConfig 中的字段，包含类型信息和实际值
 */
export interface FieldWrapper<T = any> {
  type: FieldType
  value: T
}

/**
 * AI 配置字段类型
 * 可能是字符串、数字或数组的包装器
 */
export type AIConfigField =
  | FieldWrapper<boolean>
  | FieldWrapper<string>
  | FieldWrapper<number>
  | FieldWrapper<any[]>

/**
 * AI 配置类型（带包装器）
 * 前端内部使用的配置结构
 */
export type AIConfigWithWrapper = Record<string, AIConfigField>

/**
 * AI 配置类型（扁平化）
 * 提交到后端时使用的配置结构
 */
export type AIConfigFlattened = Record<string, any>
