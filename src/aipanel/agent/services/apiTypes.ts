// 聊天API相关的类型定义
import type { ChatMessageUser } from '@/aipanel/agent/types'

// API端点配置
export const API_ENDPOINTS = {
  createSession: '/api/agent/create-session',
  sendMessage: '/api/agent/send-message',
} as const

// API响应类型定义
export interface CreateSessionResponse {
  session_id: string
  created_at: string
}

export interface SendMessageRequest {
  session_id: string
  message: ChatMessageUser // 使用 ChatMessageUser 类型
}

export interface ApiError {
  detail: string
  status_code?: number
}
