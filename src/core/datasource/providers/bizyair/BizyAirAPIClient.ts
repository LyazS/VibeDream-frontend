/**
 * BizyAir API Client
 *
 * 直接调用 BizyAir 官方 API，实现异步任务提交、状态查询、结果获取等功能
 * 使用现代浏览器 fetch API，支持重试机制和进度回调
 *
 * @module BizyAirAPIClient
 */

import type {
  BizyAirTaskDetail,
  BizyAirTaskStatus,
  ProgressCallback,
  SubmitTaskResponse,
  TaskDetailResponse,
  TaskResultResponse,
} from './types'

// ==================== 常量定义 ====================

/**
 * BizyAir API 基础 URL
 * 使用 .cn 域名避免 CORS 预检请求的重定向问题
 */
const BASE_URL = 'https://api.bizyair.cn/w/v1/webapp/task/openapi'

/**
 * 默认重试次数
 */
const DEFAULT_MAX_RETRIES = 3

/**
 * 默认初始延迟（毫秒）
 */
const DEFAULT_INITIAL_DELAY = 2000

/**
 * 默认最大延迟（毫秒）
 */
const DEFAULT_MAX_DELAY = 10000

/**
 * 默认请求超时（毫秒）
 */
const DEFAULT_TIMEOUT = 30000

/**
 * 默认轮询间隔（毫秒）
 */
const DEFAULT_POLL_INTERVAL = 3000

/**
 * 最大连续错误次数
 */
const MAX_CONSECUTIVE_ERRORS = 5

/**
 * 默认任务超时时间（毫秒）
 */
const DEFAULT_TASK_TIMEOUT = 1800 * 1000 // 30 分钟

// ==================== 自定义错误类 ====================

/**
 * BizyAir API 错误基类
 */
export class BizyAirAPIError extends Error {
  constructor(
    message: string,
    public statusCode?: number,
    public errorCode?: string,
  ) {
    super(message)
    this.name = 'BizyAirAPIError'
  }
}

/**
 * BizyAir 认证错误
 */
export class BizyAirAuthError extends BizyAirAPIError {
  constructor(message: string = 'API Key 无效或已过期') {
    super(message, 401)
    this.name = 'BizyAirAuthError'
  }
}

/**
 * BizyAir 任务错误
 */
export class BizyAirTaskError extends Error {
  constructor(
    public taskId: string,
    message: string,
  ) {
    super(message)
    this.name = 'BizyAirTaskError'
  }
}

/**
 * BizyAir 速率限制错误
 */
export class BizyAirRateLimitError extends BizyAirAPIError {
  constructor(message: string = 'API 调用频率超限') {
    super(message, 429)
    this.name = 'BizyAirRateLimitError'
  }
}

/**
 * BizyAir 网络错误
 */
export class BizyAirNetworkError extends BizyAirAPIError {
  constructor(message: string = '网络错误') {
    super(message)
    this.name = 'BizyAirNetworkError'
  }
}

/**
 * BizyAir 超时错误
 */
export class BizyAirTimeoutError extends BizyAirAPIError {
  constructor(message: string = '请求超时') {
    super(message)
    this.name = 'BizyAirTimeoutError'
  }
}

// ==================== 工具函数 ====================

/**
 * 延迟函数
 *
 * @param ms - 延迟毫秒数
 * @returns Promise
 */
function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * 检查请求是否被中止
 *
 * @param signal - AbortSignal
 * @throws {DOMException} 如果请求被中止
 */
function checkAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw new DOMException('Request was aborted', 'AbortError')
  }
}

// ==================== BizyAirAPIClient 主类 ====================

/**
 * BizyAir API 客户端类
 *
 * 提供与 BizyAir API 交互的所有方法，包括任务提交、状态查询、结果获取等
 */
export class BizyAirAPIClient {
  // ==================== 公共 API 方法 ====================

  /**
   * 提交异步任务到 BizyAir
   *
   * @param requestData - 请求数据
   * @param apiKey - BizyAir API Key
   * @param signal - 可选的 AbortSignal 用于取消请求
   * @returns Promise<string> - 返回任务 ID (request_id)
   * @throws {BizyAirAuthError} - API Key 无效
   * @throws {BizyAirRateLimitError} - 请求频率超限
   * @throws {BizyAirAPIError} - API 错误
   * @throws {BizyAirNetworkError} - 网络错误
   * @throws {BizyAirTimeoutError} - 请求超时
   *
   * @example
   * ```typescript
   * const taskId = await BizyAirAPIClient.submitAsyncTask(
   *   { app_id: 'xxx', input_mapping: {...} },
   *   'your-api-key'
   * )
   * ```
   */
  static async submitAsyncTask(
    requestData: Record<string, any>,
    apiKey: string,
    signal?: AbortSignal,
  ): Promise<string> {
    const endpoint = `${BASE_URL}/create`

    const response = await this.fetchWithAuth(endpoint, apiKey, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Bizyair-Task-Async': 'enable', // 启用异步模式
      },
      body: JSON.stringify(requestData),
      signal,
    })

    // 处理响应
    if (response.status === 202) {
      const result: SubmitTaskResponse = await response.json()
      const requestId = result.request_id

      if (!requestId) {
        throw new BizyAirAPIError('响应中缺少 request_id')
      }

      console.log(`[BizyAir] 成功提交任务: ${requestId}`)
      return requestId
    }

    // 处理错误响应
    await this.handleErrorResponse(response)
    throw new BizyAirAPIError('任务提交失败')
  }

  /**
   * 查询任务状态
   *
   * @param requestId - 任务 ID
   * @param apiKey - BizyAir API Key
   * @param signal - 可选的 AbortSignal 用于取消请求
   * @returns Promise<BizyAirTaskDetail> - 任务详情
   * @throws {BizyAirAuthError} - API Key 无效
   * @throws {BizyAirTaskError} - 任务不存在
   * @throws {BizyAirRateLimitError} - 请求频率超限
   * @throws {BizyAirAPIError} - API 错误
   *
   * @example
   * ```typescript
   * const detail = await BizyAirAPIClient.getTaskStatus(
   *   'task-id',
   *   'your-api-key'
   * )
   * console.log(detail.status) // 'Queuing' | 'Running' | 'Success' | ...
   * ```
   */
  static async getTaskStatus(
    requestId: string,
    apiKey: string,
    signal?: AbortSignal,
  ): Promise<BizyAirTaskDetail> {
    const url = `${BASE_URL}/detail?requestId=${encodeURIComponent(requestId)}`

    const response = await this.fetchWithAuth(url, apiKey, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
      },
      signal,
    })

    if (response.status === 200) {
      const result: TaskDetailResponse = await response.json()

      if (result.data) {
        return result.data
      }

      throw new BizyAirAPIError('响应格式异常')
    }

    // 处理错误响应
    if (response.status === 404) {
      throw new BizyAirTaskError(requestId, '任务不存在')
    }

    await this.handleErrorResponse(response)
    throw new BizyAirAPIError('获取任务状态失败')
  }

  /**
   * 获取任务结果
   *
   * @param requestId - 任务 ID
   * @param apiKey - BizyAir API Key
   * @param signal - 可选的 AbortSignal 用于取消请求
   * @returns Promise<{ url: string }> - 任务结果（包含输出文件 URL）
   * @throws {BizyAirAuthError} - API Key 无效
   * @throws {BizyAirTaskError} - 任务不存在或结果不可用
   * @throws {BizyAirRateLimitError} - 请求频率超限
   * @throws {BizyAirAPIError} - API 错误
   *
   * @example
   * ```typescript
   * const result = await BizyAirAPIClient.getTaskResults(
   *   'task-id',
   *   'your-api-key'
   * )
   * console.log(result.url) // 输出文件 URL
   * ```
   */
  static async getTaskResults(
    requestId: string,
    apiKey: string,
    signal?: AbortSignal,
  ): Promise<{ url: string }> {
    const url = `${BASE_URL}/outputs?requestId=${encodeURIComponent(requestId)}`

    const response = await this.fetchWithAuth(url, apiKey, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
      },
      signal,
    })

    if (response.status === 200) {
      const result: TaskResultResponse = await response.json()

      if (result.data?.outputs && result.data.outputs.length > 0) {
        return { url: result.data.outputs[0].object_url }
      }

      throw new BizyAirAPIError('响应格式异常：缺少输出文件')
    }

    // 处理错误响应
    if (response.status === 404) {
      throw new BizyAirTaskError(requestId, '任务不存在或结果不可用')
    }

    await this.handleErrorResponse(response)
    throw new BizyAirAPIError('获取任务结果失败')
  }

  /**
   * 轮询任务直到完成
   *
   * 使用指数退避策略轮询任务状态，直到任务完成或失败
   *
   * @param requestId - 任务 ID
   * @param apiKey - BizyAir API Key
   * @param onProgress - 进度回调函数
   * @param signal - 可选的 AbortSignal 用于取消轮询
   * @param options - 可选配置
   * @param options.pollInterval - 轮询间隔（毫秒），默认 3000
   * @param options.timeout - 任务超时时间（毫秒），默认 600000 (10分钟)
   * @returns Promise<BizyAirTaskDetail> - 最终任务详情
   * @throws {BizyAirTaskError} - 任务超时或连续查询失败
   * @throws {DOMException} - 请求被中止
   *
   * @example
   * ```typescript
   * const detail = await BizyAirAPIClient.pollUntilComplete(
   *   'task-id',
   *   'your-api-key',
   *   (progress, status) => {
   *     console.log(`进度: ${progress}%, 状态: ${status}`)
   *   }
   * )
   * ```
   */
  static async pollUntilComplete(
    requestId: string,
    apiKey: string,
    onProgress?: (progress: number, status: string) => void,
    signal?: AbortSignal,
    options?: {
      pollInterval?: number
      timeout?: number
    },
  ): Promise<BizyAirTaskDetail> {
    const pollInterval = options?.pollInterval ?? DEFAULT_POLL_INTERVAL
    const timeout = options?.timeout ?? DEFAULT_TASK_TIMEOUT

    const startTime = Date.now()
    let lastProgress = 50
    let consecutiveErrors = 0

    while (true) {
      // 检查是否被中止
      checkAborted(signal)

      // 检查是否超时
      const elapsedTime = Date.now() - startTime
      if (elapsedTime > timeout) {
        throw new BizyAirTaskError(requestId, `任务超时，已等待 ${Math.floor(timeout / 1000)} 秒`)
      }

      try {
        // 查询任务状态
        const statusData = await this.getTaskStatus(requestId, apiKey, signal)
        const status = statusData.status

        // 重置错误计数
        consecutiveErrors = 0

        // 计算进度和消息
        let progress: number
        let message: string

        switch (status) {
          case 'Queuing':
            progress = Math.min(50 + Math.floor((elapsedTime / timeout) * 10), 60)
            const queueCount = statusData.queueInfo?.queue_count ?? -1
            message =
              queueCount >= 0
                ? `任务排队中... (前面还有 ${queueCount} 个任务) bizyair任务ID: ${requestId}`
                : `任务排队中... bizyair任务ID: ${requestId}`
            break

          case 'Preparing':
            progress = Math.min(60 + Math.floor((elapsedTime / timeout) * 10), 70)
            message = `任务准备中... bizyair任务ID: ${requestId}`
            break

          case 'Running':
            progress = Math.min(70 + Math.floor((elapsedTime / timeout) * 20), 90)
            message = `任务运行中... bizyair任务ID: ${requestId}`
            break

          case 'Success':
            onProgress?.(95, '任务完成，正在获取结果...')
            return statusData

          case 'Failed':
          case 'Canceled':
            return statusData

          default:
            progress = Math.min(lastProgress + 5, 90)
            message = `任务状态: ${status}`
        }

        // 只在进度有变化时更新
        if (progress > lastProgress) {
          onProgress?.(progress, message)
          lastProgress = progress
        }
      } catch (error) {
        consecutiveErrors++

        // 如果是中止错误，直接抛出
        if (error instanceof DOMException && error.name === 'AbortError') {
          throw error
        }

        // 连续错误超过阈值，抛出异常
        if (consecutiveErrors >= MAX_CONSECUTIVE_ERRORS) {
          throw new BizyAirTaskError(
            requestId,
            `连续 ${MAX_CONSECUTIVE_ERRORS} 次查询失败: ${error instanceof Error ? error.message : String(error)}`,
          )
        }

        console.warn(`[BizyAir] 查询任务状态失败 (第 ${consecutiveErrors} 次):`, error)

        onProgress?.(
          lastProgress,
          `查询状态失败，正在重试... (${consecutiveErrors}/${MAX_CONSECUTIVE_ERRORS})`,
        )
      }

      // 等待后继续轮询
      await delay(pollInterval)
    }
  }

  /**
   * 取消任务
   *
   * @param requestId - 任务 ID
   * @param apiKey - BizyAir API Key
   * @param signal - 可选的 AbortSignal 用于取消请求
   * @returns Promise<boolean> - 是否成功取消
   *
   * @example
   * ```typescript
   * const success = await BizyAirAPIClient.cancelTask(
   *   'task-id',
   *   'your-api-key'
   * )
   * if (success) {
   *   console.log('任务已取消')
   * }
   * ```
   */
  static async cancelTask(
    requestId: string,
    apiKey: string,
    signal?: AbortSignal,
  ): Promise<boolean> {
    const url = `${BASE_URL}/cancel?requestId=${encodeURIComponent(requestId)}`

    try {
      const response = await this.fetchWithAuth(url, apiKey, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
        },
        signal,
      })

      if (response.status === 200) {
        console.log(`[BizyAir] 成功取消任务: ${requestId}`)
        return true
      }

      const errorText = await response.text()
      console.warn(`[BizyAir] 取消任务失败: ${response.status} - ${errorText}`)
      return false
    } catch (error) {
      console.error(`[BizyAir] 取消任务异常:`, error)
      return false
    }
  }

  // ==================== 私有方法 ====================

  /**
   * 带重试机制的请求方法（指数退避）
   *
   * @param fn - 要执行的异步函数
   * @param maxRetries - 最大重试次数，默认 3
   * @param initialDelay - 初始延迟（毫秒），默认 2000
   * @param maxDelay - 最大延迟（毫秒），默认 10000
   * @returns Promise<T> - 函数执行结果
   * @throws 最后一次尝试的错误
   *
   * @private
   */
  private static async retryWithBackoff<T>(
    fn: () => Promise<T>,
    maxRetries: number = DEFAULT_MAX_RETRIES,
    initialDelay: number = DEFAULT_INITIAL_DELAY,
    maxDelay: number = DEFAULT_MAX_DELAY,
  ): Promise<T> {
    let lastError: Error | undefined

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        return await fn()
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error))

        // 最后一次尝试失败，不再重试
        if (attempt === maxRetries) {
          break
        }

        // 计算延迟时间（指数退避）
        const delayTime = Math.min(initialDelay * Math.pow(2, attempt), maxDelay)

        console.warn(
          `[BizyAir] 请求失败 (第 ${attempt + 1}/${maxRetries + 1} 次)，${delayTime}ms 后重试:`,
          lastError.message,
        )

        await delay(delayTime)
      }
    }

    throw lastError
  }

  /**
   * 带认证的 fetch 请求
   *
   * 自动添加 Authorization header，并处理超时
   *
   * @param endpoint - API 端点 URL
   * @param apiKey - BizyAir API Key
   * @param options - fetch 选项
   * @returns Promise<Response> - fetch 响应
   * @throws {BizyAirNetworkError} - 网络错误
   * @throws {BizyAirTimeoutError} - 请求超时
   *
   * @private
   */
  private static async fetchWithAuth(
    endpoint: string,
    apiKey: string,
    options: RequestInit = {},
  ): Promise<Response> {
    const requestOptions: RequestInit = {
      ...options,
      headers: {
        ...options.headers,
        Authorization: `Bearer ${apiKey}`,
      },
    }

    try {
      // 使用重试机制
      return await this.retryWithBackoff(async () => {
        // 创建超时控制器
        const controller = new AbortController()
        const timeoutId = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT)

        try {
          const response = await fetch(endpoint, {
            ...requestOptions,
            signal: options.signal || controller.signal,
          })

          clearTimeout(timeoutId)
          return response
        } catch (error) {
          clearTimeout(timeoutId)
          throw error
        }
      })
    } catch (error) {
      // 处理网络错误
      if (error instanceof TypeError) {
        throw new BizyAirNetworkError(`网络错误: ${error.message}`)
      }

      // 处理超时错误
      if (error instanceof DOMException && error.name === 'AbortError') {
        throw new BizyAirTimeoutError('请求超时')
      }

      // 其他错误直接抛出
      throw error
    }
  }

  /**
   * 处理错误响应
   *
   * 根据状态码抛出相应的错误
   *
   * @param response - fetch 响应
   * @throws {BizyAirAuthError} - 401/403
   * @throws {BizyAirRateLimitError} - 429
   * @throws {BizyAirAPIError} - 其他错误
   *
   * @private
   */
  private static async handleErrorResponse(response: Response): Promise<never> {
    const errorText = await response.text()

    switch (response.status) {
      case 401:
      case 403:
        throw new BizyAirAuthError()

      case 429:
        throw new BizyAirRateLimitError()

      default:
        throw new BizyAirAPIError(
          `API 错误: ${response.status} - ${errorText || '未知错误'}`,
          response.status,
        )
    }
  }
}
