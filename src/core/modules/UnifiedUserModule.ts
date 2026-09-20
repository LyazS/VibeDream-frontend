import { ref, computed } from 'vue'
import { fetchClient } from '@/utils/fetchClient'
import { ModuleRegistry, MODULE_NAMES } from '@/core/modules/ModuleRegistry'
import { useAppI18n } from '@/core/composables/useI18n'
import type { UnifiedUseNaiveUIModule } from '@/core/modules/UnifiedUseNaiveUIModule'
import type { User } from '@/utils/types'
import { formatMoneyForDisplay } from '@/utils/money'
import { isDefinitiveOperationFailure } from '@/utils/idempotency'

export type { User, LoginRequest, RegisterRequest } from '@/utils/types'

const BIZYAIR_API_KEY_STORAGE_KEY = 'bizyair_api_key'
const INITIALIZATION_RETRY_DELAYS_MS = [500, 1000, 2000] as const
type AuthResult = Record<string, unknown>

export function createUnifiedUserModule(registry: ModuleRegistry) {
  const useNaiveUIModule = registry.get<UnifiedUseNaiveUIModule>(MODULE_NAMES.USENAIVEUI)
  const { t } = useAppI18n()
  const currentUser = ref<User | null>(null)
  const isLoggingIn = ref(false)
  const isRegistering = ref(false)
  const isUsingActivationCode = ref(false)
  const bizyairApiKey = ref<string>(getBizyAirApiKey())
  let refreshBalancePromise: Promise<void> | null = null
  let pendingActivationCodeOperation: { code: string; key: string } | null = null
  let authStateVersion = 0
  let isInitialized = false
  let initializationPromise: Promise<void> | null = null
  let authMutationActive = false

  const isLoggedIn = computed(() => currentUser.value !== null)
  const username = computed(() => currentUser.value?.username || '')

  function saveUserData(user: User): void {
    currentUser.value = user
  }

  function clearUserData(): void {
    currentUser.value = null
    pendingActivationCodeOperation = null
  }

  fetchClient.setUnauthorizedHandler(
    (status, data) => {
      const isAccountDisabled =
        typeof data === 'object' &&
        data !== null &&
        'error' in data &&
        data.error === 'ACCOUNT_DISABLED'
      if (status !== 401 && !isAccountDisabled) return
      // A session rejected by the API is no longer safe to keep in editor memory.
      if (currentUser.value) authStateVersion += 1
      clearUserData()
    },
    () => authStateVersion,
  )

  function errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error)
  }

  function beginAuthMutation(): number {
    if (authMutationActive) throw new Error(t('user.authInProgress'))
    authMutationActive = true
    pendingActivationCodeOperation = null
    return ++authStateVersion
  }

  function getErrorStatus(error: unknown): number | undefined {
    if (!error || typeof error !== 'object' || !('status' in error)) return undefined
    const status = (error as { status?: unknown }).status
    return typeof status === 'number' ? status : undefined
  }

  function isRetryableInitializationError(error: unknown): boolean {
    const status = getErrorStatus(error)
    return status === undefined || status >= 500
  }

  function waitForRetry(delayMs: number): Promise<void> {
    return new Promise((resolve) => globalThis.setTimeout(resolve, delayMs))
  }

  async function loadUserData(requestVersion = authStateVersion): Promise<void> {
    try {
      const response = await fetchClient.get<User>('/api/users/me')
      if (requestVersion !== authStateVersion) return
      if (response.status === 200) saveUserData(response.data)
    } catch (error) {
      if (requestVersion !== authStateVersion) return
      const status = getErrorStatus(error)
      if (status === 401 || status === 403) {
        clearUserData()
        return
      }
      throw error
    }
  }

  async function loadUserDataWithRetry(requestVersion: number): Promise<void> {
    for (let attempt = 0; ; attempt += 1) {
      try {
        await loadUserData(requestVersion)
        return
      } catch (error) {
        if (
          requestVersion !== authStateVersion ||
          !isRetryableInitializationError(error) ||
          attempt >= INITIALIZATION_RETRY_DELAYS_MS.length
        ) {
          throw error
        }
        await waitForRetry(INITIALIZATION_RETRY_DELAYS_MS[attempt])
      }
    }
  }

  async function refreshBalance(): Promise<void> {
    if (!currentUser.value || refreshBalancePromise)
      return refreshBalancePromise || Promise.resolve()
    const userAtRequest = currentUser.value
    const balanceAtRequest = userAtRequest.balance
    refreshBalancePromise = (async () => {
      try {
        const response = await fetchClient.get<{ balance: string }>('/api/balance')
        if (currentUser.value === userAtRequest && currentUser.value.balance === balanceAtRequest) {
          saveUserData({ ...currentUser.value, balance: response.data.balance })
        }
      } catch {
        // FetchClient clears the session on 401; other transient errors do not block editing.
      } finally {
        refreshBalancePromise = null
      }
    })()
    return refreshBalancePromise
  }

  async function login(email: string, password: string): Promise<AuthResult> {
    const operationVersion = beginAuthMutation()
    isLoggingIn.value = true
    try {
      const response = await fetchClient.post<AuthResult>('/api/auth/sign-in/email', {
        email: email.trim().toLowerCase(),
        password,
      })
      await loadUserDataWithRetry(operationVersion)
      if (operationVersion !== authStateVersion) throw new Error(t('user.loginFailed'))
      if (!currentUser.value) throw new Error(t('user.loginFailed'))
      isInitialized = true
      useNaiveUIModule.messageSuccess(t('user.loginSuccess') + currentUser.value.username)
      return { ...response.data, user: currentUser.value }
    } catch (error) {
      if (operationVersion === authStateVersion) clearUserData()
      const message = errorMessage(error) || t('user.loginFailed')
      if (operationVersion === authStateVersion) useNaiveUIModule.messageError(message)
      throw new Error(message)
    } finally {
      isLoggingIn.value = false
      authMutationActive = false
    }
  }

  async function register(name: string, email: string, password: string): Promise<AuthResult> {
    const operationVersion = beginAuthMutation()
    isRegistering.value = true
    try {
      const response = await fetchClient.post<AuthResult>('/api/auth/sign-up/email', {
        name: name.trim(),
        email: email.trim().toLowerCase(),
        password,
      })
      await loadUserDataWithRetry(operationVersion)
      if (operationVersion !== authStateVersion) throw new Error(t('user.registerFailed'))
      if (!currentUser.value) throw new Error(t('user.registerFailed'))
      isInitialized = true
      useNaiveUIModule.messageSuccess(t('user.registerSuccess'))
      return { ...response.data, user: currentUser.value }
    } catch (error) {
      if (operationVersion === authStateVersion) clearUserData()
      const message = errorMessage(error) || t('user.registerFailed')
      if (operationVersion === authStateVersion) useNaiveUIModule.messageError(message)
      throw new Error(message)
    } finally {
      isRegistering.value = false
      authMutationActive = false
    }
  }

  async function logout(): Promise<void> {
    const operationVersion = beginAuthMutation()
    try {
      await fetchClient.post('/api/auth/sign-out')
      if (operationVersion !== authStateVersion) return
      clearUserData()
      isInitialized = true
      useNaiveUIModule.messageSuccess(t('user.logoutSuccess'))
    } catch (error) {
      if (operationVersion === authStateVersion) {
        useNaiveUIModule.messageError(t('user.logoutFailed'))
      }
      throw error
    } finally {
      authMutationActive = false
    }
  }

  async function useActivationCode(codeValue: string): Promise<void> {
    if (isUsingActivationCode.value) return
    isUsingActivationCode.value = true
    const code = codeValue.trim().toUpperCase()
    const userAtRequest = currentUser.value?.id
    const requestVersion = authStateVersion
    const operation =
      pendingActivationCodeOperation?.code === code
        ? pendingActivationCodeOperation
        : { code, key: crypto.randomUUID() }
    pendingActivationCodeOperation = operation
    try {
      const response = await fetchClient.post<{
        amount: string
        current_balance: string
        transaction_id: string
      }>(
        '/api/activation-code/use',
        { code },
        {
          headers: { 'Idempotency-Key': operation.key },
        },
      )
      if (requestVersion !== authStateVersion || currentUser.value?.id !== userAtRequest) return
      if (currentUser.value)
        saveUserData({ ...currentUser.value, balance: response.data.current_balance })
      useNaiveUIModule.messageSuccess(
        t('user.activationCodeSuccess', {
          amount: formatMoneyForDisplay(response.data.amount),
          balance: formatMoneyForDisplay(response.data.current_balance),
        }),
      )
      pendingActivationCodeOperation = null
    } catch (error) {
      if (requestVersion !== authStateVersion) return
      if (pendingActivationCodeOperation === operation && isDefinitiveOperationFailure(error)) {
        pendingActivationCodeOperation = null
      }
      const message = errorMessage(error) || t('user.activationCodeError')
      useNaiveUIModule.messageError(message)
      throw new Error(message)
    } finally {
      isUsingActivationCode.value = false
    }
  }

  function getCurrentUser(): User | null {
    return currentUser.value
  }
  function checkLoginStatus(): boolean {
    return isLoggedIn.value
  }

  function saveBizyAirApiKey(apiKey: string): void {
    localStorage.setItem(BIZYAIR_API_KEY_STORAGE_KEY, apiKey.trim())
    bizyairApiKey.value = apiKey.trim()
  }
  function getBizyAirApiKey(): string {
    return localStorage.getItem(BIZYAIR_API_KEY_STORAGE_KEY) || ''
  }
  function clearBizyAirApiKey(): void {
    localStorage.removeItem(BIZYAIR_API_KEY_STORAGE_KEY)
    bizyairApiKey.value = ''
  }
  function hasBizyAirApiKey(): boolean {
    return bizyairApiKey.value.length > 0
  }

  function initialize(): Promise<void> {
    if (isInitialized) return Promise.resolve()
    if (initializationPromise) return initializationPromise

    const requestVersion = authStateVersion
    const promise = loadUserDataWithRetry(requestVersion).then(() => {
      if (requestVersion === authStateVersion) isInitialized = true
    })
    initializationPromise = promise
    void promise
      .finally(() => {
        if (initializationPromise === promise) initializationPromise = null
      })
      .catch(() => undefined)
    return initializationPromise
  }
  void initialize().catch((error) => {
    console.warn('初始化用户信息失败，可稍后重试:', errorMessage(error))
  })

  return {
    currentUser,
    isLoggingIn,
    isRegistering,
    isUsingActivationCode,
    bizyairApiKey,
    isLoggedIn,
    username,
    login,
    register,
    logout,
    getCurrentUser,
    checkLoginStatus,
    refreshBalance,
    useActivationCode,
    saveBizyAirApiKey,
    getBizyAirApiKey,
    clearBizyAirApiKey,
    hasBizyAirApiKey,
    initialize,
  }
}

export type UnifiedUserModule = ReturnType<typeof createUnifiedUserModule>
