import type { MoneyString } from '@/utils/money'

// 用户类型定义
export interface User {
  username: string
  email?: string
  balance: MoneyString
  total_recharged: MoneyString
  total_consumed: MoneyString
  is_active: boolean
  is_superuser: boolean
  created_at: string
  last_login_at?: string
}

// 认证相关请求和响应接口
export interface LoginRequest {
  username: string
  password: string
}

export interface LoginResponse {
  access_token: string
  refresh_token: string
  expires_in: number
  /** 访问令牌的有效期，单位：秒 */
  refresh_expires_in: number
  /** 刷新令牌的有效期，单位：秒 */
  user: User
}

export interface RegisterRequest {
  username: string
  password: string
}

export interface RegisterResponse {
  access_token: string
  refresh_token: string
  expires_in: number
  /** 访问令牌的有效期，单位：秒 */
  refresh_expires_in: number
  /** 刷新令牌的有效期，单位：秒 */
  user: User
  message: string
}

export interface RefreshTokenRequest {
  refresh_token: string
}

export interface RefreshTokenResponse {
  access_token: string
  refresh_token: string
  expires_in: number
  /** 访问令牌的有效期，单位：秒 */
  refresh_expires_in: number
  /** 刷新令牌的有效期，单位：秒 */
}

export interface LogoutRequest {
  refresh_token: string
}

export interface LogoutResponse {
  message: string
}

// 令牌存储接口
export interface TokenStorage {
  access_token: string
  refresh_token: string
  expires_at: number
  refresh_expires_at: number
}

// 认证事件类型
export interface AuthEvent {
  type: 'logout' | 'token_refresh' | 'login'
  data?: any
  timestamp: number
}

// API请求配置接口
export interface RequestConfig extends RequestInit {
  timeout?: number
  headers?: Record<string, string>
  isRetry?: boolean // 标记是否为重试请求
  responseType?: 'json' | 'text' | 'blob' | 'auto' // 响应数据解析方式，默认为 'auto'
  params?: Record<string, string | number | boolean | null | undefined>
}

// API响应接口
export interface ApiResponse<T = any> {
  data: T
  status: number
  statusText: string
  headers: Headers
}
