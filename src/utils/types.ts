import type { MoneyString } from '@/utils/money'

export interface User {
  id?: string
  username: string
  email?: string
  balance: MoneyString
  banned: boolean
  admin_access: boolean
  root_admin: boolean
  created_at: string
  last_login_at?: string
}

export interface LoginRequest {
  email: string
  password: string
}

export interface RegisterRequest extends LoginRequest {
  name: string
}

/** Better Auth returns a session cookie; no token fields belong in this type. */
export interface BetterAuthResponse {
  user?: {
    id: string
    name: string
    email: string
  }
  session?: {
    id: string
    expiresAt: string
  }
}

export interface RequestConfig extends RequestInit {
  timeout?: number
  headers?: Record<string, string>
  isRetry?: boolean
  responseType?: 'json' | 'text' | 'blob' | 'auto'
  params?: Record<string, string | number | boolean | null | undefined>
}

export interface ApiResponse<T = unknown> {
  data: T
  status: number
  statusText: string
  headers: Headers
}
