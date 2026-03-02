// 统一的fetch客户端封装
import { tokenManager } from '@/utils/tokenManager'
import type { RequestConfig, ApiResponse } from '@/utils/types'

// 重新导出类型以供其他模块使用
export type { RequestConfig, ApiResponse } from '@/utils/types'

// API配置
const API_BASE_URL = import.meta.env.VITE_API_BASE_URL

// 调试标记
const DEBUG_FETCH = true
const debugPrefix = '[TOKEN]'

// 临时跳过认证开关（测试时设为 true）
const SKIP_AUTH = true

// 统一的fetch客户端
export class FetchClient {
  private baseURL: string
  private defaultHeaders: Record<string, string>

  constructor(baseURL: string = API_BASE_URL) {
    this.baseURL = baseURL
    this.defaultHeaders = {
      'Content-Type': 'application/json',
      Accept: 'application/json',
    }
  }

  /**
   * 发送GET请求
   */
  async get<T = any>(url: string, config: RequestConfig = {}): Promise<ApiResponse<T>> {
    // 如果是API请求且不是认证相关的请求，使用带认证的方法（除非跳过认证）
    if (!SKIP_AUTH && this.isApiRequest(url) && !this.isAuthRequest(url)) {
      return this.requestWithAuth<T>(url, { ...config, method: 'GET' })
    }
    return this.request<T>(url, { ...config, method: 'GET' })
  }

  /**
   * 发送POST请求
   */
  async post<T = any>(
    url: string,
    data?: any,
    config: RequestConfig = {},
  ): Promise<ApiResponse<T>> {
    // 如果是API请求且不是认证相关的请求，使用带认证的方法（除非跳过认证）
    if (!SKIP_AUTH && this.isApiRequest(url) && !this.isAuthRequest(url)) {
      return this.requestWithAuth<T>(url, {
        ...config,
        method: 'POST',
        body: data ? JSON.stringify(data) : undefined,
      })
    }
    return this.request<T>(url, {
      ...config,
      method: 'POST',
      body: data ? JSON.stringify(data) : undefined,
    })
  }

  /**
   * 发送DELETE请求
   */
  async delete<T = any>(url: string, config: RequestConfig = {}): Promise<ApiResponse<T>> {
    // 如果是API请求且不是认证相关的请求，使用带认证的方法（除非跳过认证）
    if (!SKIP_AUTH && this.isApiRequest(url) && !this.isAuthRequest(url)) {
      return this.requestWithAuth<T>(url, { ...config, method: 'DELETE' })
    }
    return this.request<T>(url, { ...config, method: 'DELETE' })
  }

  /**
   * 检查是否是API请求
   */
  private isApiRequest(url: string): boolean {
    return url.startsWith('/api/')
  }

  /**
   * 检查是否是认证相关的请求
   */
  private isAuthRequest(url: string): boolean {
    return url.startsWith('/api/auth/')
  }

  /**
   * NDJSON解析器
   * 解析Newline Delimited JSON格式的流式数据
   */
  private parseNDJSON<T>(chunk: string): T[] {
    const messages: T[] = []
    const lines = chunk.split('\n').filter((line) => line.trim())

    for (const line of lines) {
      try {
        const message = JSON.parse(line) as T
        messages.push(message)
      } catch (error) {
        console.warn('JSON解析失败:', error, line)
      }
    }

    return messages
  }

  /**
   * 通用流式请求方法
   * 适用于需要实时接收数据的场景，如聊天消息、进度监控等
   */
  async stream<T>(
    method: 'GET' | 'POST',
    url: string,
    onMessage: (message: T) => Promise<boolean | void> | boolean | void,
    data?: any,
    config: RequestConfig = {},
  ): Promise<void> {
    // 如果是API请求且不是认证相关的请求，使用带认证的方法（除非跳过认证）
    if (!SKIP_AUTH && this.isApiRequest(url) && !this.isAuthRequest(url)) {
      return this.streamWithAuth<T>(method, url, onMessage, data, config)
    }
    return this.streamWithoutAuth<T>(method, url, onMessage, data, config)
  }

  /**
   * 带认证的流式请求方法
   */
  private async streamWithAuth<T>(
    method: 'GET' | 'POST',
    url: string,
    onMessage: (message: T) => Promise<boolean | void> | boolean | void,
    data?: any,
    config: RequestConfig = {},
  ): Promise<void> {
    if (DEBUG_FETCH) {
      console.log(`${debugPrefix} 发送认证流式请求:`, {
        url,
        method,
        isRetry: config.isRetry || false,
      })
    }

    // 1. 检查令牌是否需要刷新
    if (tokenManager.shouldRefreshToken() && !config.isRetry) {
      if (DEBUG_FETCH) {
        console.log(`${debugPrefix} 流式请求前检查: 令牌需要刷新`)
      }
      const refreshed = await tokenManager.refreshToken()
      if (!refreshed) {
        throw new Error('令牌刷新失败，请重新登录')
      }
    }

    // 2. 添加Authorization头
    const headers = { ...this.defaultHeaders, ...config.headers }
    const token = tokenManager.getAccessToken()
    if (token) {
      headers['Authorization'] = `Bearer ${token}`
      if (DEBUG_FETCH) {
        console.log(`${debugPrefix} 添加Authorization头到流式请求:`, token.substring(0, 20) + '...')
      }
    } else {
      if (DEBUG_FETCH) {
        console.warn(`${debugPrefix} 没有可用的访问令牌用于流式请求`)
      }
    }

    // 3. 发送流式请求
    try {
      await this.streamWithoutAuth<T>(method, url, onMessage, data, { ...config, headers })
      if (DEBUG_FETCH) {
        console.log(`${debugPrefix} 流式请求成功:`, {
          url,
          method,
        })
      }
    } catch (error: any) {
      // 4. 处理401错误
      if (error.status === 401 && !config.isRetry) {
        console.warn(`${debugPrefix} 流式请求收到401响应，尝试刷新令牌`)
        const refreshed = await tokenManager.refreshToken()
        if (refreshed) {
          // 重试请求
          console.log(`${debugPrefix} 令牌刷新成功，重试流式请求`)
          const retryHeaders = { ...headers }
          const retryToken = tokenManager.getAccessToken()
          if (retryToken) {
            retryHeaders['Authorization'] = `Bearer ${retryToken}`
          }
          return this.streamWithoutAuth<T>(method, url, onMessage, data, {
            ...config,
            headers: retryHeaders,
            isRetry: true,
          })
        } else {
          // 刷新失败，清除令牌并抛出错误
          console.error(`${debugPrefix} 令牌刷新失败，清除令牌`)
          tokenManager.clearTokens()
          throw new Error('认证失败，请重新登录')
        }
      }

      if (DEBUG_FETCH) {
        console.error(`${debugPrefix} 流式请求失败:`, {
          url,
          status: error.status,
          message: error.message,
        })
      }

      throw error
    }
  }

  /**
   * 不带认证的流式请求方法
   */
  private async streamWithoutAuth<T>(
    method: 'GET' | 'POST',
    url: string,
    onMessage: (message: T) => Promise<boolean | void> | boolean | void,
    data?: any,
    config: RequestConfig = {},
  ): Promise<void> {
    const fullUrl = this.buildURL(url)
    const headers: Record<string, string> = { ...this.defaultHeaders, ...config.headers }

    // 流式请求使用application/x-ndjson接受类型
    headers['Accept'] = 'application/x-ndjson'

    const response = await fetch(fullUrl, {
      method,
      headers,
      body: data ? JSON.stringify(data) : undefined,
      signal: config.signal,
    })

    if (!response.ok) {
      const error = new Error(`HTTP错误: ${response.status} ${response.statusText}`) as any
      error.status = response.status
      throw error
    }

    if (!response.body) {
      throw new Error('响应体为空')
    }

    // 处理流式响应
    const reader = response.body.getReader()
    const decoder = new TextDecoder()

    try {
      while (true) {
        const { done, value } = await reader.read()

        if (done) {
          break
        }

        // 解码chunk
        const chunk = decoder.decode(value, { stream: true })

        // 解析NDJSON格式的消息
        const messages = this.parseNDJSON<T>(chunk)

        // 处理每个JSON消息
        for (const message of messages) {
          const shouldStop = await onMessage(message)
          if (shouldStop) {
            console.log('[FetchClient] 收到停止信号，提前退出流读取')
            return
          }
        }
      }
    } finally {
      reader.releaseLock()
    }
  }

  /**
   * 带认证的请求方法
   */
  private async requestWithAuth<T = any>(
    url: string,
    config: RequestConfig,
  ): Promise<ApiResponse<T>> {
    if (DEBUG_FETCH) {
      console.log(`${debugPrefix} 发送认证请求:`, {
        url,
        method: config.method || 'GET',
        isRetry: config.isRetry || false,
      })
    }

    // 1. 检查令牌是否需要刷新
    if (tokenManager.shouldRefreshToken() && !config.isRetry) {
      if (DEBUG_FETCH) {
        console.log(`${debugPrefix} 请求前检查: 令牌需要刷新`)
      }
      const refreshed = await tokenManager.refreshToken()
      if (!refreshed) {
        throw new Error('令牌刷新失败，请重新登录')
      }
    }

    // 2. 添加Authorization头
    const headers = { ...this.defaultHeaders, ...config.headers }
    const token = tokenManager.getAccessToken()
    if (token) {
      headers['Authorization'] = `Bearer ${token}`
      if (DEBUG_FETCH) {
        console.log(`${debugPrefix} 添加Authorization头:`, token.substring(0, 20) + '...')
      }
    } else {
      if (DEBUG_FETCH) {
        console.warn(`${debugPrefix} 没有可用的访问令牌`)
      }
    }

    // 3. 发送请求
    try {
      const response = await this.request<T>(url, { ...config, headers })
      if (DEBUG_FETCH) {
        console.log(`${debugPrefix} 请求成功:`, {
          url,
          status: response.status,
          statusText: response.statusText,
        })
      }
      return response
    } catch (error: any) {
      // 4. 处理401错误
      if (error.status === 401 && !config.isRetry) {
        console.warn(`${debugPrefix} 收到401响应，尝试刷新令牌`)
        const refreshed = await tokenManager.refreshToken()
        if (refreshed) {
          // 重试请求
          console.log(`${debugPrefix} 令牌刷新成功，重试原始请求`)
          return this.requestWithAuth<T>(url, { ...config, headers, isRetry: true })
        } else {
          // 刷新失败，清除令牌并抛出错误
          console.error(`${debugPrefix} 令牌刷新失败，清除令牌`)
          tokenManager.clearTokens()
          throw new Error('认证失败，请重新登录')
        }
      }

      if (DEBUG_FETCH) {
        console.error(`${debugPrefix} 请求失败:`, {
          url,
          status: error.status,
          message: error.message,
        })
      }

      throw error
    }
  }

  /**
   * 通用的请求方法
   */
  private async request<T = any>(url: string, config: RequestConfig): Promise<ApiResponse<T>> {
    const fullUrl = this.buildURL(url)
    const headers = { ...this.defaultHeaders, ...config.headers }

    // 创建中止控制器（如果提供了超时）
    let timeoutId: number | undefined
    let abortController: AbortController | undefined

    if (config.timeout) {
      abortController = new AbortController()
      timeoutId = setTimeout(() => {
        abortController!.abort()
      }, config.timeout)
    }

    try {
      const response = await fetch(fullUrl, {
        ...config,
        headers,
        signal: config.signal || abortController?.signal,
      })

      // 清除超时
      if (timeoutId) {
        clearTimeout(timeoutId)
      }

      // 处理响应
      let data: T

      // 根据配置的响应类型进行解析
      switch (config.responseType || 'auto') {
        case 'json':
          data = await response.json()
          break
        case 'text':
          data = (await response.text()) as T
          break
        case 'blob':
          data = (await response.blob()) as T
          break
        case 'auto':
        default:
          // 保留原有的自动检测逻辑
          if (response.headers.get('content-type')?.includes('application/json')) {
            data = await response.json()
          } else {
            data = (await response.text()) as T
          }
          break
      }

      return {
        data,
        status: response.status,
        statusText: response.statusText,
        headers: response.headers,
      }
    } catch (error: any) {
      // 清除超时
      if (timeoutId) {
        clearTimeout(timeoutId)
      }

      // 处理错误响应
      if (error.status) {
        throw error
      }

      if (error instanceof Error) {
        if (error.name === 'AbortError') {
          throw new Error('请求超时')
        }
        throw error
      }
      throw new Error('网络请求失败')
    }
  }

  /**
   * 构建完整的URL
   */
  private buildURL(url: string): string {
    if (url.startsWith('http')) {
      return url
    }
    return `${this.baseURL}${url}`
  }
}

// 创建全局实例
export const fetchClient = new FetchClient()

export function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export async function sleepWithAbortSignal(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const timeoutId = setTimeout(resolve, ms)

    if (signal) {
      signal.addEventListener('abort', () => {
        clearTimeout(timeoutId)
        reject(new Error('Sleep interrupted'))
      })
    }
  })
}
