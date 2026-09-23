import { API_BASE_URL } from '@/config/runtimeConfig'

export interface TaskProgressUpdate {
  task_id: string
  capability: string
  status: string
  revision: number
  origin_tab_id?: string
}

export interface TaskProgressSubscription<T extends TaskProgressUpdate = TaskProgressUpdate> {
  next(signal: AbortSignal): Promise<T>
  close(): void
}

type TaskProgressMessage = {
  type: 'task.snapshot' | 'task.updated'
  task: TaskProgressUpdate
  heartbeat: boolean
}

const MAX_SUBSCRIPTIONS = 500
const MAX_RECONNECT_ATTEMPTS = 6
const HEARTBEAT_INTERVAL_MS = 30_000
const HEARTBEAT_TIMEOUT_MS = 10_000
const HEARTBEAT_PING = 'task.ping'
const HEARTBEAT_PONG = 'task.pong'

type Subscription = {
  id: string
  taskId: string
  originTabId: string
  revision: number
  error?: Error
  queue: TaskProgressUpdate[]
  waiters: Set<{
    resolve: (task: TaskProgressUpdate) => void
    reject: (error: Error) => void
  }>
}

type TaskWaiter = Subscription['waiters'] extends Set<infer T> ? T : never

function taskProgressUrl(): string {
  // 页面可通过 Pages 同源代理访问 Worker；这里随当前协议切换 ws/wss，
  // 不在前端硬编码任何 Worker 域名或认证信息。
  const base = API_BASE_URL || globalThis.location?.origin
  if (!base) throw new Error('当前环境不支持任务进度 WebSocket')
  const url = new URL('/api/task-progress', base)
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:'
  return url.toString()
}

function parseTaskProgressMessage(value: unknown): TaskProgressMessage | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const message = value as Record<string, unknown>
  if (message.type !== 'task.snapshot' && message.type !== 'task.updated') return null
  const task = message.task
  if (!task || typeof task !== 'object' || Array.isArray(task)) return null
  const record = task as Record<string, unknown>
  // 先在通用层验证任务协议的最小字段，具体能力再由各自的 type guard 收窄。
  if (
    typeof record.task_id !== 'string' ||
    typeof record.capability !== 'string' ||
    typeof record.status !== 'string' ||
    typeof record.revision !== 'number' ||
    !Number.isSafeInteger(record.revision) ||
    record.revision < 1
  )
    return null
  return { type: message.type, task: record as unknown as TaskProgressUpdate, heartbeat: message.heartbeat === true }
}

/**
 * 所有媒体能力共用的一条 Cloudflare TaskProgressHub WebSocket。
 * 每个订阅独立保存 taskId、originTabId 和已见 revision；连接断开后会把这些信息重新发送，
 * 后端据此返回 D1 快照，因此这里不需要轮询任务状态。
 */
export class CloudflareTaskProgressClient {
  private socket: WebSocket | undefined
  private reconnectTimer: ReturnType<typeof setTimeout> | undefined
  private heartbeatInterval: ReturnType<typeof setInterval> | undefined
  private heartbeatTimeout: ReturnType<typeof setTimeout> | undefined
  private reconnectAttempts = 0
  private subscriptions = new Map<string, Subscription>()

  subscribe(taskId: string, originTabId: string): TaskProgressSubscription {
    if (new Set([...this.subscriptions.values()].map((item) => item.taskId)).size >= MAX_SUBSCRIPTIONS &&
      ![...this.subscriptions.values()].some((item) => item.taskId === taskId)) {
      throw new Error('同时订阅的媒体任务超过上限')
    }
    const subscription: Subscription = {
      id: crypto.randomUUID(),
      taskId,
      originTabId,
      revision: 0,
      queue: [],
      waiters: new Set(),
    }
    // 同一个 task 可被多个调用点订阅，使用订阅实例 ID 区分，不能直接以 taskId 覆盖。
    this.subscriptions.set(subscription.id, subscription)
    this.ensureConnected()
    this.sendSubscriptions()
    return {
      next: (signal) => this.next(subscription, signal),
      close: () => this.close(subscription),
    }
  }

  private ensureConnected(): void {
    if (
      this.socket &&
      (this.socket.readyState === WebSocket.OPEN || this.socket.readyState === WebSocket.CONNECTING)
    )
      return
    if (typeof WebSocket === 'undefined') throw new Error('当前环境不支持任务进度 WebSocket')
    this.stopHeartbeat()
    // 浏览器会在同源 WebSocket 握手中自动携带会话 Cookie；不通过 JS 读取或传递 Cookie。
    const socket = new WebSocket(taskProgressUrl())
    this.socket = socket
    socket.onopen = () => {
      if (this.socket !== socket) return
      this.reconnectAttempts = 0
      this.sendSubscriptions()
    }
    socket.onmessage = (event) => {
      if (this.socket !== socket) return
      if (event.data === HEARTBEAT_PONG) {
        if (this.heartbeatTimeout) clearTimeout(this.heartbeatTimeout)
        this.heartbeatTimeout = undefined
        return
      }
      this.handleMessage(event.data)
    }
    socket.onerror = () => socket.close()
    socket.onclose = (event) => {
      if (this.socket !== socket) return
      this.stopHeartbeat()
      this.socket = undefined
      if (event.code === 4001) {
        this.failSubscriptions(new Error('会话已失效，请重新登录'))
        return
      }
      this.scheduleReconnect()
    }
  }

  private startHeartbeat(socket: WebSocket): void {
    if (this.heartbeatInterval) return
    this.heartbeatInterval = setInterval(() => {
      if (this.socket !== socket || socket.readyState !== WebSocket.OPEN || !this.subscriptions.size || this.heartbeatTimeout) return
      try {
        socket.send(HEARTBEAT_PING)
      } catch {
        socket.close()
        return
      }
      this.heartbeatTimeout = setTimeout(() => {
        this.heartbeatTimeout = undefined
        if (this.socket === socket && socket.readyState === WebSocket.OPEN) socket.close(4000, 'Heartbeat timeout')
      }, HEARTBEAT_TIMEOUT_MS)
    }, HEARTBEAT_INTERVAL_MS)
  }

  private stopHeartbeat(): void {
    if (this.heartbeatInterval) clearInterval(this.heartbeatInterval)
    if (this.heartbeatTimeout) clearTimeout(this.heartbeatTimeout)
    this.heartbeatInterval = undefined
    this.heartbeatTimeout = undefined
  }

  private scheduleReconnect(): void {
    if (!this.subscriptions.size || this.reconnectTimer) return
    if (this.reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
      this.failSubscriptions(new Error('任务进度连接失败，请稍后重试'))
      return
    }
    // 指数退避上限 10 秒，避免网络故障时持续创建连接；只要还有活跃订阅就继续恢复。
    const delay = Math.min(1_000 * 2 ** this.reconnectAttempts, 10_000)
    this.reconnectAttempts += 1
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = undefined
      this.ensureConnected()
    }, delay)
  }

  private sendSubscriptions(): void {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) return
    const revisions: Record<string, number> = {}
    for (const subscription of this.subscriptions.values()) {
      revisions[subscription.taskId] = Math.max(revisions[subscription.taskId] || 0, subscription.revision)
    }
    const originTabId = this.subscriptions.values().next().value?.originTabId
    if (!originTabId) return
    this.socket.send(JSON.stringify({
      type: 'task.subscribe', origin_tab_id: originTabId,
      task_ids: Object.keys(revisions), seen_revisions: revisions,
    }))
  }

  private handleMessage(raw: unknown): void {
    if (typeof raw !== 'string') return
    let parsed: unknown
    try {
      parsed = JSON.parse(raw)
    } catch {
      return
    }
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      const record = parsed as Record<string, unknown>
      if (record.type === 'task.error') {
        const error = new Error(typeof record.error === 'string' ? record.error : '任务订阅失败')
        for (const subscription of this.subscriptions.values()) {
          if (record.task_id && record.task_id !== subscription.taskId) continue
          subscription.error = error
          for (const waiter of subscription.waiters) waiter.reject(error)
          subscription.waiters.clear()
        }
        return
      }
    }
    const message = parseTaskProgressMessage(parsed)
    if (!message) return
    if (message.heartbeat && this.socket) this.startHeartbeat(this.socket)
    for (const subscription of this.subscriptions.values()) {
      // 旧 revision 可能来自重连前在途消息，必须忽略，保证 UI 状态只向前推进。
      if (
        subscription.taskId !== message.task.task_id ||
        message.task.revision < subscription.revision
      )
        continue
      subscription.revision = message.task.revision
      const waiter = subscription.waiters.values().next().value as TaskWaiter | undefined
      if (waiter) {
        subscription.waiters.delete(waiter)
        waiter.resolve(message.task)
      } else {
        // 尚未调用 next() 时只保留最新状态；任务进度不是需要逐条回放的日志。
        subscription.queue.splice(0, subscription.queue.length, message.task)
      }
    }
  }

  private failSubscriptions(error: Error): void {
    for (const subscription of this.subscriptions.values()) {
      subscription.error = error
      for (const waiter of subscription.waiters) waiter.reject(error)
      subscription.waiters.clear()
    }
  }

  private next(subscription: Subscription, signal: AbortSignal): Promise<TaskProgressUpdate> {
    if (subscription.error) return Promise.reject(subscription.error)
    const queued = subscription.queue.shift()
    if (queued) return Promise.resolve(queued)
    if (signal.aborted) return Promise.reject(new DOMException('任务已取消', 'AbortError'))
    // AbortSignal 只取消当前等待，不会关闭其他任务订阅共享的 WebSocket。
    return new Promise((resolve, reject) => {
      const abort = () => {
        subscription.waiters.delete(waiter)
        reject(new DOMException('任务已取消', 'AbortError'))
      }
      signal.addEventListener('abort', abort, { once: true })
      const waiter: TaskWaiter = {
        resolve: (task) => {
          signal.removeEventListener('abort', abort)
          resolve(task)
        },
        reject: (error) => {
          signal.removeEventListener('abort', abort)
          reject(error)
        },
      }
      subscription.waiters.add(waiter)
    })
  }

  private close(subscription: Subscription): void {
    this.subscriptions.delete(subscription.id)
    for (const waiter of subscription.waiters)
      waiter.reject(new DOMException('任务已取消', 'AbortError'))
    subscription.waiters.clear()
    if (this.subscriptions.size) {
      this.sendSubscriptions()
      return
    }
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer)
    this.reconnectTimer = undefined
    this.stopHeartbeat()
    // 最后一个订阅关闭时才关闭连接，避免短任务结束影响仍在执行的其他媒体任务。
    this.socket?.close(1000, 'No active task subscriptions')
    this.socket = undefined
  }
}

// 导出唯一实例，确保同一编辑器页只建立一条任务进度连接。
export const cloudflareTaskProgressClient = new CloudflareTaskProgressClient()
