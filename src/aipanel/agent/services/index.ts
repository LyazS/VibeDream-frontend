// 通用fetch客户端
export { fetchClient } from '@/utils/fetchClient'
export type { ApiResponse, RequestConfig } from '@/utils/fetchClient'

// API类型定义
export { API_ENDPOINTS } from './apiTypes'
export type {
  CreateSessionResponse,
  SendMessageRequest,
  ApiError,
} from './apiTypes'

// 会话管理器
export { SESSION_MANAGER } from './SessionManager'
export type { SessionInfo } from './SessionManager'
