/**
 * ASR 语音识别数据源类型定义
 * 集中管理所有 ASR 相关的类型、接口和枚举
 */

// ==================== 枚举定义 ====================

/**
 * ASR 任务状态枚举
 */
export enum ASRTaskStatus {
  PENDING = 'PENDING', // 等待处理
  PROCESSING = 'PROCESSING', // 处理中
  COMPLETED = 'COMPLETED', // 已完成
  FAILED = 'FAILED', // 失败
  CANCELLED = 'CANCELLED', // 已取消
}

// ==================== 核心接口定义 ====================

/**
 * 字/词级别信息
 */
export interface ASRWord {
  text: string
  start_time: number // 毫秒
  end_time: number // 毫秒
  blank_duration?: number // 可选的空白时长
}

/**
 * 分句信息
 */
export interface ASRUtterance {
  text: string
  start_time: number // 毫秒
  end_time: number // 毫秒
  definite?: boolean // 是否确定
  words?: ASRWord[] // 字/词级别信息
}

/**
 * 识别结果数据
 */
export interface ASRResultData {
  text: string // 完整识别文本
  utterances?: ASRUtterance[] // 分句信息
}

/**
 * 音频信息
 */
export interface ASRAudioInfo {
  duration: number // 毫秒
}

/**
 * ASR 查询响应 (对应后端 ASRQueryResponse)
 */
export interface ASRQueryResponse {
  result?: ASRResultData
  audio_info: ASRAudioInfo
}

/**
 * ASR 请求配置
 */
export interface ASRRequestConfig {
  audio_url: string // 音频文件 URL
  audio_format: string // 音频格式: raw/wav/mp3/ogg
  estimated_duration: number // 预估时长（秒）
}

// ==================== 数据源接口定义 ====================

/**
 * ASR 任务结果数据类型
 * ASR 专用的任务结果数据结构
 */
export interface ASRTaskResultData {
  url: string
  asr_result?: ASRQueryResponse // ASR 结果存储在 asr_result 字段中
}

/**
 * ASR 数据源基础数据接口 - 只包含持久化数据
 */
export interface BaseASRSourceData {
  readonly type: 'asr'
  asrTaskId: string // ASR 任务 ID
  requestConfig: ASRRequestConfig // 请求配置
  resultData?: ASRTaskResultData // 识别结果数据（ASR 专用类型）
  taskStatus: ASRTaskStatus // 任务状态
  sourceTimelineItemId?: string // 来源时间轴项目 ID
  placeholderTimelineItemId?: string // 占位符时间轴项目 ID（loading 状态的文本 item）
}

// ==================== API 响应类型 ====================

/**
 * ASR 任务提交响应
 */
export interface ASRSubmitResponse {
  success: boolean
  task_id?: string
  error?: string
}

/**
 * ASR 进度事件类型
 */
export enum ASRStreamEventType {
  PROGRESS_UPDATE = 'progress_update',
  FINAL = 'final',
  ERROR = 'error',
}

/**
 * ASR 进度事件基础接口
 */
export interface ASRStreamEventBase {
  type: ASRStreamEventType
  task_id: string
  status: ASRTaskStatus
  progress: number
  message: string
}

/**
 * ASR 进度更新事件
 */
export interface ASRProgressEvent extends ASRStreamEventBase {
  type: ASRStreamEventType.PROGRESS_UPDATE
}

/**
 * ASR 完成事件
 */
export interface ASRFinalEvent extends ASRStreamEventBase {
  type: ASRStreamEventType.FINAL
  result_data: ASRQueryResponse
}

/**
 * ASR 错误事件
 */
export interface ASRErrorEvent extends ASRStreamEventBase {
  type: ASRStreamEventType.ERROR
  error_code?: string
}

/**
 * ASR 流事件联合类型
 */
export type ASRStreamEvent = ASRProgressEvent | ASRFinalEvent | ASRErrorEvent

// ==================== 后端 API 类型 ====================

/**
 * 后端 TaskStreamEvent 类型
 * 对应 backend/schemas/tasks.py 中的 TaskStreamEvent
 */
export interface BackendTaskStreamEvent {
  type: string
  task_id: string
  status?: ASRTaskStatus
  progress?: number
  estimated_time?: number
  content_type?: string
  result_data?: ASRTaskResultData
  message?: string
  timestamp: string
}
