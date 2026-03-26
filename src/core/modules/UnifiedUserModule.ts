import { ref, computed, type Ref } from 'vue'
import { fetchClient } from '@/utils/fetchClient'
import { tokenManager } from '@/utils/tokenManager'
import { ModuleRegistry, MODULE_NAMES } from '@/core/modules/ModuleRegistry'
import { useAppI18n } from '@/core/composables/useI18n'
import type { UnifiedUseNaiveUIModule } from '@/core/modules/UnifiedUseNaiveUIModule'
import type {
  User,
  LoginRequest,
  LoginResponse,
  RegisterRequest,
  RegisterResponse,
  TokenStorage,
} from '@/utils/types'

// 重新导出类型以供其他模块使用
export type {
  User,
  LoginRequest,
  LoginResponse,
  RegisterRequest,
  RegisterResponse,
} from '@/utils/types'

// 调试标记
const DEBUG_USER = true
const debugPrefix = '[TOKEN]'

type UserModuleError = Error & {
  status?: number
  data?: {
    detail?: string
  }
}

// LocalStorage 键名常量
const BIZYAIR_API_KEY_STORAGE_KEY = 'bizyair_api_key'

/**
 * 统一用户管理模块
 * 基于新架构统一类型系统的用户管理，提供用户认证和状态管理功能
 */
export function createUnifiedUserModule(registry: ModuleRegistry) {
  // 通过注册中心获取依赖模块
  const useNaiveUIModule = registry.get<UnifiedUseNaiveUIModule>(MODULE_NAMES.USENAIVEUI)

  // 获取国际化函数
  const { t } = useAppI18n()

  // ==================== 状态定义 ====================

  // 当前登录用户
  const currentUser = ref<User | null>(null)

  // 登录加载状态
  const isLoggingIn = ref(false)

  // 注册加载状态
  const isRegistering = ref(false)

  // 激活码使用加载状态
  const isUsingActivationCode = ref(false)

  // BizyAir API Key（响应式状态，初始化时从 localStorage 加载）
  const bizyairApiKey = ref<string>(getBizyAirApiKey())

  // ==================== 计算属性 ====================

  /**
   * 用户是否已登录
   */
  const isLoggedIn = computed(() => !!tokenManager.getAccessToken() && !!currentUser.value)

  /**
   * 用户名显示
   */
  const username = computed(() => currentUser.value?.username || '')

  // ==================== 私有方法 ====================

  /**
   * 保存用户信息到localStorage
   */
  function saveUserData(user: User): void {
    localStorage.setItem('current_user', JSON.stringify(user))
    currentUser.value = user
  }

  function toUserModuleError(error: unknown): UserModuleError {
    if (error instanceof Error) {
      return error as UserModuleError
    }
    return new Error(String(error))
  }

  /**
   * 从localStorage加载用户数据，然后从后端获取最新数据
   */
  async function loadUserData(): Promise<void> {
    // 1. 首先从localStorage加载用户数据（显示旧数据）
    const userStr = localStorage.getItem('current_user')

    if (userStr) {
      try {
        const user = JSON.parse(userStr) as User
        currentUser.value = user
        if (DEBUG_USER) {
          console.log(`${debugPrefix} 从localStorage加载用户数据:`, user.username)
        }
      } catch (error) {
        console.error('解析用户信息失败:', error)
        clearUserData()
      }
    }

    // 2. 尝试从后端获取最新用户信息（fetchClient会自动处理令牌检查和刷新）
    try {
      if (DEBUG_USER) {
        console.log(`${debugPrefix} 从后端获取最新用户信息`)
      }

      const response = await fetchClient.get<User>('/api/users/me')

      if (response.status === 200) {
        // 更新用户数据
        saveUserData(response.data)
        if (DEBUG_USER) {
          console.log(`${debugPrefix} 后端用户数据更新成功:`, response.data.username)
        }
      }
    } catch (error: unknown) {
      const userError = toUserModuleError(error)
      // 后端请求失败，但继续使用localStorage的数据
      console.warn(`${debugPrefix} 后端用户信息获取失败，继续使用localStorage数据:`, userError.message)
      if (userError.status === 401) {
        // 如果是认证错误，清除令牌
        tokenManager.clearTokens()
        clearUserData()
      }
    }
  }

  /**
   * 清除用户数据
   */
  function clearUserData(): void {
    localStorage.removeItem('current_user')
    currentUser.value = null
  }

  // ==================== 用户认证方法 ====================

  /**
   * 用户登录
   */
  async function login(username: string, password: string): Promise<LoginResponse> {
    if (DEBUG_USER) {
      console.log(`${debugPrefix} 开始登录流程:`, { username })
    }

    try {
      isLoggingIn.value = true

      const response = await fetchClient.post<LoginResponse>('/api/auth/login', {
        username,
        password,
      })

      if (DEBUG_USER) {
        console.log(`${debugPrefix} 登录响应:`, {
          status: response.status,
          hasAccessToken: !!response.data.access_token,
          hasRefreshToken: !!response.data.refresh_token,
          expiresIn: response.data.expires_in,
          refreshExpiresIn: response.data.refresh_expires_in,
          username: response.data.user.username,
        })
      }

      if (response.status === 200) {
        // 使用TokenManager保存令牌
        const now = Date.now()
        tokenManager.saveTokens({
          access_token: response.data.access_token,
          refresh_token: response.data.refresh_token,
          expires_at: now + response.data.expires_in * 1000,
          refresh_expires_at: now + response.data.refresh_expires_in * 1000,
        })

        // 保存用户信息
        saveUserData(response.data.user)

        if (DEBUG_USER) {
          console.log(`${debugPrefix} 登录成功，用户信息已保存`)
        }

        useNaiveUIModule.messageSuccess(t('user.loginSuccess') + response.data.user.username)
      }

      return response.data
    } catch (error: unknown) {
      const userError = toUserModuleError(error)
      console.error(`${debugPrefix} 登录失败:`, userError)
      const errorMessage = userError.message || t('user.loginFailed')
      useNaiveUIModule.messageError(errorMessage)
      throw new Error(errorMessage)
    } finally {
      isLoggingIn.value = false
    }
  }

  /**
   * 用户注册
   */
  async function register(username: string, password: string): Promise<RegisterResponse> {
    if (DEBUG_USER) {
      console.log(`${debugPrefix} 开始注册流程:`, { username })
    }

    try {
      isRegistering.value = true

      const response = await fetchClient.post<RegisterResponse>('/api/auth/register', {
        username,
        password,
      })

      if (DEBUG_USER) {
        console.log(`${debugPrefix} 注册响应:`, {
          status: response.status,
          hasAccessToken: !!response.data.access_token,
          hasRefreshToken: !!response.data.refresh_token,
          expiresIn: response.data.expires_in,
          refreshExpiresIn: response.data.refresh_expires_in,
          username: response.data.user.username,
          message: response.data.message,
        })
      }

      if (response.status === 201) {
        // 使用TokenManager保存令牌
        const now = Date.now()
        tokenManager.saveTokens({
          access_token: response.data.access_token,
          refresh_token: response.data.refresh_token,
          expires_at: now + response.data.expires_in * 1000,
          refresh_expires_at: now + response.data.refresh_expires_in * 1000,
        })

        // 保存用户信息
        saveUserData(response.data.user)

        if (DEBUG_USER) {
          console.log(`${debugPrefix} 注册成功，用户信息已保存`)
        }

        useNaiveUIModule.messageSuccess(t('user.registerSuccess'))
      }

      return response.data
    } catch (error: unknown) {
      const userError = toUserModuleError(error)
      console.error(`${debugPrefix} 注册失败:`, userError)
      const errorMessage = userError.message || t('user.registerFailed')
      useNaiveUIModule.messageError(errorMessage)
      throw new Error(errorMessage)
    } finally {
      isRegistering.value = false
    }
  }

  /**
   * 用户登出
   */
  async function logout(): Promise<void> {
    if (DEBUG_USER) {
      console.log(`${debugPrefix} 开始登出流程`)
    }

    try {
      const refreshToken = tokenManager.getRefreshToken()
      if (refreshToken) {
        if (DEBUG_USER) {
          console.log(`${debugPrefix} 通知后端撤销刷新令牌`)
        }
        // 通知后端撤销刷新令牌
        await fetchClient.post('/api/auth/logout', {
          refresh_token: refreshToken,
        })
        if (DEBUG_USER) {
          console.log(`${debugPrefix} 后端登出请求成功`)
        }
      } else {
        if (DEBUG_USER) {
          console.log(`${debugPrefix} 没有刷新令牌，跳过后端登出请求`)
        }
      }
    } catch (error) {
      console.error(`${debugPrefix} 登出请求失败:`, error)
    } finally {
      // 无论后端请求是否成功，都清除本地数据
      if (DEBUG_USER) {
        console.log(`${debugPrefix} 清除本地令牌和用户数据`)
      }
      tokenManager.clearTokens()
      clearUserData()
      useNaiveUIModule.messageSuccess(t('user.logoutSuccess'))
    }
  }

  /**
   * 获取当前用户信息
   */
  function getCurrentUser(): User | null {
    return currentUser.value
  }

  /**
   * 获取访问令牌
   */
  function getAccessToken(): string | null {
    return tokenManager.getAccessToken()
  }

  /**
   * 检查用户是否已登录
   */
  function checkLoginStatus(): boolean {
    return isLoggedIn.value
  }

  /**
   * 使用激活码充值
   */
  async function useActivationCode(code: string): Promise<void> {
    if (DEBUG_USER) {
      console.log(`${debugPrefix} 开始使用激活码:`, { code: code.substring(0, 8) + '...' })
    }

    try {
      isUsingActivationCode.value = true

      const response = await fetchClient.post<{
        amount: number
        current_balance: number
        detail?: string
      }>('/api/activation-code/use', {
        code: code.trim(),
      })

      if (response.status === 200) {
        // 显示成功通知
        useNaiveUIModule.messageSuccess(
          t('user.activationCodeSuccess', {
            amount: response.data.amount,
            balance: response.data.current_balance,
          }),
        )

        // 更新用户余额信息
        if (currentUser.value) {
          currentUser.value.balance = response.data.current_balance
          currentUser.value.total_recharged += response.data.amount
          saveUserData(currentUser.value)
        }

        if (DEBUG_USER) {
          console.log(`${debugPrefix} 激活码使用成功:`, {
            amount: response.data.amount,
            newBalance: response.data.current_balance,
          })
        }
      } else {
        // 状态码不是200，抛出错误让catch块统一处理
        const errorMessage = response.data?.detail || t('user.activationCodeError')
        throw new Error(errorMessage)
      }
    } catch (error: unknown) {
      const userError = toUserModuleError(error)
      console.error(`${debugPrefix} 激活码使用失败:`, userError)

      // 统一错误通知处理
      if (userError.status === 400 || userError.status === 422) {
        useNaiveUIModule.messageError(userError.data?.detail || t('user.activationCodeInvalid'))
      } else if (userError.status === 401) {
        useNaiveUIModule.messageError(t('user.activationCodeUnauthorized'))
      } else {
        useNaiveUIModule.messageError(userError.message || t('user.activationCodeError'))
      }

      throw new Error(userError.message || t('user.activationCodeError'))
    } finally {
      isUsingActivationCode.value = false
    }
  }

  // ==================== BizyAir API Key 管理 ====================

  /**
   * 保存 BizyAir API Key 到 localStorage
   * 注意：这个方法只保存到 localStorage，不更新响应式状态
   * 因为 v-model 已经直接修改了 bizyairApiKey.value
   */
  function saveBizyAirApiKey(apiKey: string): void {
    const trimmedKey = apiKey.trim()
    localStorage.setItem(BIZYAIR_API_KEY_STORAGE_KEY, trimmedKey)
    if (DEBUG_USER) {
      console.log(`${debugPrefix} BizyAir API Key 已保存到 localStorage:`, trimmedKey.substring(0, 8) + '...')
    }
  }

  /**
   * 从 localStorage 获取 BizyAir API Key
   */
  function getBizyAirApiKey(): string {
    const apiKey = localStorage.getItem(BIZYAIR_API_KEY_STORAGE_KEY) || ''
    if (DEBUG_USER && apiKey) {
      console.log(`${debugPrefix} BizyAir API Key 已加载:`, apiKey.substring(0, 8) + '...')
    }
    return apiKey
  }

  /**
   * 清除 BizyAir API Key
   */
  function clearBizyAirApiKey(): void {
    localStorage.removeItem(BIZYAIR_API_KEY_STORAGE_KEY)
    bizyairApiKey.value = ''
    if (DEBUG_USER) {
      console.log(`${debugPrefix} BizyAir API Key 已清除`)
    }
  }

  /**
   * 检查 BizyAir API Key 是否已配置
   */
  function hasBizyAirApiKey(): boolean {
    return bizyairApiKey.value.length > 0
  }

  // ==================== 初始化 ====================

  // 模块初始化时加载用户数据
  let initializationPromise: Promise<void> | null = null

  /**
   * 初始化用户模块
   */
  function initialize(): Promise<void> {
    if (!initializationPromise) {
      initializationPromise = loadUserData()
    }
    return initializationPromise
  }

  // 立即开始初始化，但不阻塞模块创建
  initialize()

  // ==================== 导出接口 ====================

  return {
    // 状态
    currentUser,
    isLoggingIn,
    isRegistering,
    isUsingActivationCode,
    bizyairApiKey,

    // 计算属性
    isLoggedIn,
    username,

    // 用户认证方法
    login,
    register,
    logout,

    // 用户信息获取
    getCurrentUser,
    getAccessToken,
    checkLoginStatus,

    // 激活码功能
    useActivationCode,

    // BizyAir API Key 管理
    saveBizyAirApiKey,
    getBizyAirApiKey,
    clearBizyAirApiKey,
    hasBizyAirApiKey,

    // 令牌管理
    refreshToken: () => tokenManager.refreshToken(),
    isTokenExpired: () => tokenManager.isAccessTokenExpired(),
    shouldRefreshToken: () => tokenManager.shouldRefreshToken(),

    // 初始化
    initialize,
  }
}

// 导出类型定义
export type UnifiedUserModule = ReturnType<typeof createUnifiedUserModule>
