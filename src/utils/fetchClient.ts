import type { ApiResponse, RequestConfig } from '@/utils/types'
import { assertApiCapabilityEnabled } from '@/config/apiCapabilities'
import { API_BASE_URL } from '@/config/runtimeConfig'

export type { RequestConfig, ApiResponse } from '@/utils/types'

interface HTTPError extends Error {
  status: number
  code?: string
}

type UnauthorizedHandler = (status: number, data?: unknown) => void

function isHTTPError(error: unknown): error is HTTPError {
  return error instanceof Error && 'status' in error
}

function extractErrorMessage(data: unknown, fallback: string): string {
  if (!data || typeof data !== 'object') return fallback
  if ('message' in data && typeof data.message === 'string' && data.message.trim())
    return data.message
  if ('detail' in data && typeof data.detail === 'string' && data.detail.trim()) return data.detail
  return fallback
}

/**
 * The browser never receives an access token. Better Auth owns the HttpOnly
 * session cookie and every request opts into cookie credentials explicitly.
 */
export class FetchClient {
  private baseURL: string
  private defaultHeaders: Record<string, string>
  private unauthorizedHandler: { handle: UnauthorizedHandler; version: () => number } | undefined

  constructor(baseURL: string = API_BASE_URL) {
    this.baseURL = baseURL
    this.defaultHeaders = {
      'Content-Type': 'application/json',
      Accept: 'application/json',
    }
  }

  setUnauthorizedHandler(
    handler?: UnauthorizedHandler,
    version: () => number = () => 0,
  ): () => void {
    const registration = handler ? { handle: handler, version } : undefined
    this.unauthorizedHandler = registration
    return () => {
      if (this.unauthorizedHandler === registration) this.unauthorizedHandler = undefined
    }
  }

  get<T = unknown>(url: string, config: RequestConfig = {}): Promise<ApiResponse<T>> {
    return this.request<T>(url, { ...config, method: 'GET' })
  }

  post<T = unknown>(
    url: string,
    data?: unknown,
    config: RequestConfig = {},
  ): Promise<ApiResponse<T>> {
    return this.request<T>(url, {
      ...config,
      method: 'POST',
      body: data === undefined ? undefined : JSON.stringify(data),
    })
  }

  put<T = unknown>(
    url: string,
    data?: unknown,
    config: RequestConfig = {},
  ): Promise<ApiResponse<T>> {
    return this.request<T>(url, {
      ...config,
      method: 'PUT',
      body: data === undefined ? undefined : JSON.stringify(data),
    })
  }

  delete<T = unknown>(url: string, config: RequestConfig = {}): Promise<ApiResponse<T>> {
    return this.request<T>(url, { ...config, method: 'DELETE' })
  }

  async stream<T>(
    method: 'GET' | 'POST',
    url: string,
    onMessage: (message: T) => Promise<boolean | void> | boolean | void,
    data?: unknown,
    config: RequestConfig = {},
  ): Promise<void> {
    assertApiCapabilityEnabled(url)
    const notifyUnauthorized = this.captureUnauthorizedHandler()
    const fullUrl = this.buildURL(url, config.params)
    const headers = { ...this.defaultHeaders, Accept: 'application/x-ndjson', ...config.headers }
    const response = await fetch(fullUrl, {
      ...config,
      method,
      body: data === undefined ? undefined : JSON.stringify(data),
      headers,
      credentials: 'include',
    })
    if (!response.ok) {
      const payload = await response.text()
      notifyUnauthorized(response.status, this.parseErrorPayload(payload))
      const error = new Error(
        extractErrorMessage(payload, `HTTP错误: ${response.status}`),
      ) as HTTPError
      error.status = response.status
      throw error
    }
    const reader = response.body?.getReader()
    if (!reader) return
    const decoder = new TextDecoder()
    let buffer = ''
    while (true) {
      const { value, done } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split('\n')
      buffer = lines.pop() || ''
      for (const line of lines) {
        if (!line.trim()) continue
        const shouldStop = await onMessage(JSON.parse(line) as T)
        if (shouldStop === true) {
          await reader.cancel()
          return
        }
      }
    }
    if (buffer.trim()) await onMessage(JSON.parse(buffer) as T)
  }

  private async request<T = unknown>(url: string, config: RequestConfig): Promise<ApiResponse<T>> {
    assertApiCapabilityEnabled(url)
    const notifyUnauthorized = this.captureUnauthorizedHandler()
    const fullUrl = this.buildURL(url, config.params)
    const headers = { ...this.defaultHeaders, ...config.headers }
    let timeoutId: ReturnType<typeof setTimeout> | undefined
    const controller = config.signal ? undefined : new AbortController()
    if (config.timeout) timeoutId = setTimeout(() => controller?.abort(), config.timeout)
    try {
      const {
        params: _params,
        timeout: _timeout,
        isRetry: _isRetry,
        responseType: _responseType,
        ...requestInit
      } = config
      const response = await fetch(fullUrl, {
        ...requestInit,
        headers,
        credentials: 'include',
        signal: config.signal || controller?.signal,
      })
      const data = await this.readResponse<T>(response, config.responseType)
      notifyUnauthorized(response.status, data)
      if (!response.ok) {
        const error = new Error(
          extractErrorMessage(data, `HTTP错误: ${response.status} ${response.statusText}`),
        ) as HTTPError
        error.status = response.status
        if (data && typeof data === 'object' && 'error' in data && typeof data.error === 'string') {
          error.code = data.error
        }
        throw error
      }
      return {
        data,
        status: response.status,
        statusText: response.statusText,
        headers: response.headers,
      }
    } catch (error) {
      if (isHTTPError(error)) throw error
      if (error instanceof Error && error.name === 'AbortError') throw new Error('请求超时')
      throw error instanceof Error ? error : new Error('网络请求失败')
    } finally {
      if (timeoutId) clearTimeout(timeoutId)
    }
  }

  private async readResponse<T>(
    response: Response,
    responseType: RequestConfig['responseType'],
  ): Promise<T> {
    if (responseType === 'blob') return (await response.blob()) as T
    if (responseType === 'text') return (await response.text()) as T
    if (responseType === 'json') return (await response.json()) as T
    const type = response.headers.get('content-type') || ''
    return (type.includes('application/json') ? await response.json() : await response.text()) as T
  }

  private buildURL(url: string, params?: RequestConfig['params']): string {
    const fullUrl = url.startsWith('http') ? url : `${this.baseURL}${url}`
    if (!params) return fullUrl
    const targetUrl = new URL(fullUrl, window.location.origin)
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined && value !== null) targetUrl.searchParams.set(key, String(value))
    }
    return targetUrl.toString()
  }

  private captureUnauthorizedHandler(): UnauthorizedHandler {
    const registration = this.unauthorizedHandler
    const version = registration?.version()
    return (status, data) => {
      if (status !== 401 && status !== 403) return
      if (
        !registration ||
        registration !== this.unauthorizedHandler ||
        registration.version() !== version
      )
        return
      try {
        registration.handle(status, data)
      } catch {
        // Auth cleanup must not mask the original HTTP response.
      }
    }
  }

  private parseErrorPayload(payload: string): unknown {
    try {
      return JSON.parse(payload)
    } catch {
      return undefined
    }
  }
}

export const fetchClient = new FetchClient()

export function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export async function sleepWithAbortSignal(ms: number, signal?: AbortSignal): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const timeoutId = setTimeout(resolve, ms)
    signal?.addEventListener(
      'abort',
      () => {
        clearTimeout(timeoutId)
        reject(new Error('Sleep interrupted'))
      },
      { once: true },
    )
  })
}
