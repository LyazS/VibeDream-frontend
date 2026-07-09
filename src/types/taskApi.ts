// 任务提交错误码枚举
export enum TaskSubmitErrorCode {
  SUCCESS = 'SUCCESS',
  UNSUPPORTED_TASK_TYPE = 'UNSUPPORTED_TASK_TYPE',
  INVALID_CONFIG = 'INVALID_CONFIG',
  INSUFFICIENT_BALANCE = 'INSUFFICIENT_BALANCE',
  USER_NOT_FOUND = 'USER_NOT_FOUND',
  DATABASE_ERROR = 'DATABASE_ERROR',
  INTERNAL_ERROR = 'INTERNAL_ERROR',
  UNKNOWN_ERROR = 'UNKNOWN_ERROR',
}

// 任务提交成功响应
export interface TaskSubmitSuccessResponse {
  success: true
  task_id: string
  status: string
  created_at: string
}

// 任务提交失败响应
export interface TaskSubmitErrorResponse {
  success: false
  error_code: TaskSubmitErrorCode
  error_details: Record<string, unknown>
}

// 任务提交响应（联合类型）
export type TaskSubmitResponse = TaskSubmitSuccessResponse | TaskSubmitErrorResponse
