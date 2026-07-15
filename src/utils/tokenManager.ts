import { ref, type Ref } from 'vue'
import { fetchClient } from '@/utils/fetchClient'
import type {
  TokenStorage,
  RefreshTokenRequest,
  RefreshTokenResponse,
  AuthEvent,
} from '@/utils/types'

// 调试标记
const DEBUG_TOKEN = true
const debugPrefix = '[TOKEN]'
const TEMP_FOCUS_DEBUG_PREFIX = '[LC_TEMP_FOCUS_DEBUG][TOKEN]'

/**
 * 令牌管理器
 * 负责令牌的存储、验证、刷新和多标签页同步
 */
export class TokenManager {
  // 响应式令牌状态
  private accessToken: Ref<string | null> = ref(null)
  private refreshTokenValue: Ref<string | null> = ref(null)
  private expiresAt: Ref<number> = ref(0)
  private refreshExpiresAt: Ref<number> = ref(0)

  // 刷新锁机制
  private isRefreshing: boolean = false
  private refreshPromise: Promise<boolean> | null = null

  // 存储键名
  private readonly ACCESS_TOKEN_KEY = 'access_token'
  private readonly REFRESH_TOKEN_KEY = 'refresh_token'
  private readonly EXPIRES_AT_KEY = 'expires_at'
  private readonly REFRESH_EXPIRES_AT_KEY = 'refresh_expires_at'
  private readonly AUTH_EVENT_KEY = 'auth_event'

  constructor() {
    this.loadTokensFromStorage()
    this.setupStorageSync()
    this.setupTokenRefreshTimer()
  }

  /**
   * 保存令牌到存储和响应式状态
   */
  saveTokens(tokens: TokenStorage): void {
    if (DEBUG_TOKEN) {
      console.log(`${debugPrefix} 保存令牌:`, {
        accessToken: tokens.access_token.substring(0, 20) + '...',
        refreshToken: tokens.refresh_token.substring(0, 20) + '...',
        expiresAt: new Date(tokens.expires_at).toLocaleString(),
        refreshExpiresAt: new Date(tokens.refresh_expires_at).toLocaleString(),
      })
    }

    // 保存到localStorage
    localStorage.setItem(this.ACCESS_TOKEN_KEY, tokens.access_token)
    localStorage.setItem(this.REFRESH_TOKEN_KEY, tokens.refresh_token)
    localStorage.setItem(this.EXPIRES_AT_KEY, tokens.expires_at.toString())
    localStorage.setItem(this.REFRESH_EXPIRES_AT_KEY, tokens.refresh_expires_at.toString())

    // 更新响应式状态
    this.accessToken.value = tokens.access_token
    this.refreshTokenValue.value = tokens.refresh_token
    this.expiresAt.value = tokens.expires_at
    this.refreshExpiresAt.value = tokens.refresh_expires_at

    // 广播令牌更新事件
    this.broadcastAuthEvent('token_refresh', { tokens })

    if (DEBUG_TOKEN) {
      console.log(`${debugPrefix} 令牌保存完成`)
    }
  }

  /**
   * 从存储加载令牌
   */
  loadTokensFromStorage(): void {
    const accessToken = localStorage.getItem(this.ACCESS_TOKEN_KEY)
    const refreshToken = localStorage.getItem(this.REFRESH_TOKEN_KEY)
    const expiresAt = localStorage.getItem(this.EXPIRES_AT_KEY)
    const refreshExpiresAt = localStorage.getItem(this.REFRESH_EXPIRES_AT_KEY)

    if (DEBUG_TOKEN) {
      console.log(`${debugPrefix} 从存储加载令牌:`, {
        hasAccessToken: !!accessToken,
        hasRefreshToken: !!refreshToken,
        hasExpiresAt: !!expiresAt,
        hasRefreshExpiresAt: !!refreshExpiresAt,
      })
    }

    if (accessToken && refreshToken && expiresAt && refreshExpiresAt) {
      this.accessToken.value = accessToken
      this.refreshTokenValue.value = refreshToken
      this.expiresAt.value = parseInt(expiresAt, 10)
      this.refreshExpiresAt.value = parseInt(refreshExpiresAt, 10)

      if (DEBUG_TOKEN) {
        console.log(`${debugPrefix} 令牌加载完成:`, {
          accessToken: accessToken.substring(0, 20) + '...',
          refreshToken: refreshToken.substring(0, 20) + '...',
          expiresAt: new Date(parseInt(expiresAt, 10)).toLocaleString(),
          refreshExpiresAt: new Date(parseInt(refreshExpiresAt, 10)).toLocaleString(),
          isAccessTokenExpired: this.isAccessTokenExpired(),
          isRefreshTokenExpired: this.isRefreshTokenExpired(),
        })
      }

      // 检查令牌是否已过期
      if (this.isAccessTokenExpired()) {
        console.warn(`${debugPrefix} 访问令牌已过期，尝试刷新`)
        // 尝试刷新令牌
        this.refreshToken()
      }
    } else {
      if (DEBUG_TOKEN) {
        console.log(`${debugPrefix} 存储中没有有效的令牌`)
      }
    }
  }

  /**
   * 清除所有令牌
   */
  clearTokens(): void {
    if (DEBUG_TOKEN) {
      console.log(`${debugPrefix} 清除所有令牌`)
    }

    // 清除localStorage
    localStorage.removeItem(this.ACCESS_TOKEN_KEY)
    localStorage.removeItem(this.REFRESH_TOKEN_KEY)
    localStorage.removeItem(this.EXPIRES_AT_KEY)
    localStorage.removeItem(this.REFRESH_EXPIRES_AT_KEY)

    // 清除响应式状态
    this.accessToken.value = null
    this.refreshTokenValue.value = null
    this.expiresAt.value = 0
    this.refreshExpiresAt.value = 0

    // 广播登出事件
    this.broadcastAuthEvent('logout')

    if (DEBUG_TOKEN) {
      console.log(`${debugPrefix} 令牌清除完成`)
    }
  }

  /**
   * 获取访问令牌
   */
  getAccessToken(): string | null {
    return this.accessToken.value
  }

  /**
   * 获取刷新令牌
   */
  getRefreshToken(): string | null {
    return this.refreshTokenValue.value
  }

  /**
   * 检查访问令牌是否过期
   */
  isAccessTokenExpired(): boolean {
    if (!this.expiresAt.value) {
      if (DEBUG_TOKEN) {
        console.log(`${debugPrefix} 访问令牌过期检查: 没有过期时间，视为已过期`)
      }
      return true
    }
    const isExpired = Date.now() >= this.expiresAt.value
    if (DEBUG_TOKEN) {
      console.log(`${debugPrefix} 访问令牌过期检查:`, {
        expiresAt: new Date(this.expiresAt.value).toLocaleString(),
        currentTime: new Date().toLocaleString(),
        isExpired,
      })
    }
    return isExpired
  }

  /**
   * 检查刷新令牌是否过期
   */
  isRefreshTokenExpired(): boolean {
    if (!this.refreshExpiresAt.value) {
      if (DEBUG_TOKEN) {
        console.log(`${debugPrefix} 刷新令牌过期检查: 没有过期时间，视为已过期`)
      }
      return true
    }
    const isExpired = Date.now() >= this.refreshExpiresAt.value
    if (DEBUG_TOKEN) {
      console.log(`${debugPrefix} 刷新令牌过期检查:`, {
        refreshExpiresAt: new Date(this.refreshExpiresAt.value).toLocaleString(),
        currentTime: new Date().toLocaleString(),
        isExpired,
      })
    }
    return isExpired
  }

  /**
   * 检查是否应该刷新令牌（过期前5分钟）
   */
  shouldRefreshToken(): boolean {
    if (!this.accessToken.value || !this.refreshTokenValue.value) {
      if (DEBUG_TOKEN) {
        console.log(`${debugPrefix} 令牌刷新检查: 缺少令牌，不需要刷新`)
      }
      return false
    }

    // 如果访问令牌已过期或将在5分钟内过期，则需要刷新
    const fiveMinutesFromNow = Date.now() + 5 * 60 * 1000
    const shouldRefresh =
      Date.now() >= this.expiresAt.value - 5 * 60 * 1000 || this.isAccessTokenExpired()

    if (DEBUG_TOKEN) {
      console.log(`${debugPrefix} 令牌刷新检查:`, {
        expiresAt: new Date(this.expiresAt.value).toLocaleString(),
        currentTime: new Date().toLocaleString(),
        fiveMinutesFromNow: new Date(fiveMinutesFromNow).toLocaleString(),
        shouldRefresh,
      })
    }

    return shouldRefresh
  }

  /**
   * 刷新令牌
   */
  async refreshToken(): Promise<boolean> {
    if (DEBUG_TOKEN) {
      console.log(`${debugPrefix} 开始刷新令牌`)
    }

    // 如果正在刷新，返回现有的Promise
    if (this.isRefreshing && this.refreshPromise) {
      if (DEBUG_TOKEN) {
        console.log(`${debugPrefix} 令牌正在刷新中，等待现有刷新完成`)
      }
      return this.refreshPromise
    }

    // 如果没有刷新令牌或刷新令牌已过期，返回false
    if (!this.refreshTokenValue.value || this.isRefreshTokenExpired()) {
      if (DEBUG_TOKEN) {
        console.log(`${debugPrefix} 无法刷新令牌:`, {
          hasRefreshToken: !!this.refreshTokenValue.value,
          isRefreshTokenExpired: this.isRefreshTokenExpired(),
        })
      }
      return false
    }

    this.isRefreshing = true

    if (DEBUG_TOKEN) {
      console.log(`${debugPrefix} 设置刷新锁，开始执行刷新操作`)
    }

    this.refreshPromise = this.performRefreshToken()

    try {
      const result = await this.refreshPromise
      if (DEBUG_TOKEN) {
        console.log(`${debugPrefix} 令牌刷新结果:`, result)
      }
      return result
    } finally {
      this.isRefreshing = false
      this.refreshPromise = null
      if (DEBUG_TOKEN) {
        console.log(`${debugPrefix} 清除刷新锁`)
      }
    }
  }

  /**
   * 执行令牌刷新的实际操作
   */
  private async performRefreshToken(): Promise<boolean> {
    if (DEBUG_TOKEN) {
      console.log(`${debugPrefix} 执行令牌刷新请求`)
    }

    try {
      const response = await fetchClient.post<RefreshTokenResponse>('/api/auth/refresh', {
        refresh_token: this.refreshTokenValue.value!,
      } as RefreshTokenRequest)

      if (DEBUG_TOKEN) {
        console.log(`${debugPrefix} 刷新请求响应:`, {
          status: response.status,
          hasData: !!response.data,
          expiresIn: response.data?.expires_in,
          refreshExpiresIn: response.data?.refresh_expires_in,
        })
      }

      if (response.status === 200) {
        const now = Date.now()
        this.saveTokens({
          access_token: response.data.access_token,
          refresh_token: response.data.refresh_token,
          expires_at: now + response.data.expires_in * 1000,
          refresh_expires_at: now + response.data.refresh_expires_in * 1000,
        })

        console.log(`${debugPrefix} 令牌刷新成功`)
        return true
      }

      if (DEBUG_TOKEN) {
        console.warn(`${debugPrefix} 刷新请求返回非200状态:`, response.status)
      }
      return false
    } catch (error) {
      console.error(`${debugPrefix} 令牌刷新失败:`, error)
      // 刷新失败，清除所有令牌
      this.clearTokens()
      return false
    }
  }

  /**
   * 设置令牌自动刷新定时器
   */
  private setupTokenRefreshTimer(): void {
    // 每4分钟检查一次是否需要刷新令牌
    setInterval(
      () => {
        if (this.shouldRefreshToken() && !this.isRefreshing) {
          this.refreshToken()
        }
      },
      4 * 60 * 1000,
    )
  }

  /**
   * 设置存储事件监听，实现多标签页同步
   */
  private setupStorageSync(): void {
    window.addEventListener('storage', (event) => {
      if (event.key === this.AUTH_EVENT_KEY) {
        try {
          const authEvent = JSON.parse(event.newValue || '{}') as AuthEvent
          console.warn(`${TEMP_FOCUS_DEBUG_PREFIX} 收到 storage 认证事件:`, {
            type: authEvent.type,
            eventTimestamp: authEvent.timestamp,
            lastEventTimestamp: this.getLastEventTimestamp(),
            documentVisibility: typeof document !== 'undefined' ? document.visibilityState : 'unknown',
            hasFocus: typeof document !== 'undefined' ? document.hasFocus() : false,
            timestamp: new Date().toISOString(),
          })

          switch (authEvent.type) {
            case 'logout':
              this.clearTokens()
              // 如果不在当前标签页触发的登出，则刷新页面
              if (authEvent.timestamp !== this.getLastEventTimestamp()) {
                console.warn(`${TEMP_FOCUS_DEBUG_PREFIX} storage logout 将触发 window.location.reload()`, {
                  eventTimestamp: authEvent.timestamp,
                  lastEventTimestamp: this.getLastEventTimestamp(),
                })
                window.location.reload()
              }
              break
            case 'token_refresh':
              this.loadTokensFromStorage()
              break
            case 'login':
              this.loadTokensFromStorage()
              break
          }
        } catch (error) {
          console.error('解析认证事件失败:', error)
        }
      }
    })
  }

  /**
   * 广播认证事件到其他标签页
   */
  private broadcastAuthEvent(type: string, data?: any): void {
    const event: AuthEvent = {
      type: type as 'logout' | 'token_refresh' | 'login',
      data,
      timestamp: Date.now(),
    }

    if (DEBUG_TOKEN) {
      console.log(`${debugPrefix} 广播认证事件:`, {
        type: event.type,
        timestamp: new Date(event.timestamp).toLocaleString(),
        hasData: !!event.data,
      })
    }

    localStorage.setItem(this.AUTH_EVENT_KEY, JSON.stringify(event))
    this.setLastEventTimestamp(event.timestamp)
  }

  /**
   * 获取最后事件时间戳
   */
  private getLastEventTimestamp(): number {
    const timestamp = localStorage.getItem('last_auth_event_timestamp')
    return timestamp ? parseInt(timestamp, 10) : 0
  }

  /**
   * 设置最后事件时间戳
   */
  private setLastEventTimestamp(timestamp: number): void {
    localStorage.setItem('last_auth_event_timestamp', timestamp.toString())
  }

  /**
   * 获取响应式访问令牌
   */
  getAccessTokenRef(): Ref<string | null> {
    return this.accessToken
  }

  /**
   * 获取响应式刷新令牌
   */
  getRefreshTokenRef(): Ref<string | null> {
    return this.refreshTokenValue
  }
}

// 创建全局令牌管理器实例
export const tokenManager = new TokenManager()
