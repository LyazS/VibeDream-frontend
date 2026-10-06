// 文本单轮协议版本，客户端发出的帧和服务端事件必须使用同一版本。
export const AGENT_PROTOCOL_VERSION = 'agent-text-v2'
export type Acceptance = 'not_accepted' | 'accepted' | 'unknown'
export class AgentClientError extends Error {
  /** 携带轮次 ID 与受理状态，便于界面区分未受理、已受理及结果未知。 */
  constructor(
    public readonly code: string,
    public readonly turnId: string | undefined,
    public readonly acceptance: Acceptance,
    message = code,
  ) {
    super(message)
    this.name = 'AgentClientError'
  }
}
export type ConnectionState = Readonly<{
  /** 连接生命周期状态，disposed 表示实例已永久销毁。 */
  status: 'disconnected' | 'connecting' | 'connected' | 'disposed'
  /** 最近一次关闭原因，用于区分正常清理、身份变更和传输故障。 */
  closeReason: string | null
  /** 需要向调用方暴露的连接错误，正常空闲或页面退出时为 null。 */
  error: string | null
}>
export type TextMessage = { role: 'system' | 'user' | 'assistant'; content: string }
export type Completion = {
  turnId: string
  message: { role: 'assistant'; content: string }
  usage: { inputTokens: number; outputTokens: number; totalTokens: number } | null
}
export type StreamParams = {
  turnId: string
  taskId: string
  messages: TextMessage[]
  projectId: string
}
export type Delta = { delta: string }
export interface CompletionStream extends AsyncIterable<Delta> {
  /** 获取同一轮次的最终结果；多次调用共享同一个 Promise。 */
  finalCompletion(): Promise<Completion>
}

/** 创建可从外部完成或拒绝的 Promise，连接与轮次分别控制完成时机。 */
function deferred<T>() {
  // 保存成功完成入口，由握手确认、受理确认或最终成功事件调用。
  let resolve!: (value: T) => void
  // 保存拒绝入口，由连接异常、取消或调用失败事件调用。
  let reject!: (reason: unknown) => void
  // 对外共享的等待结果，与上述控制入口共同构成同一个异步状态。
  const promise = new Promise<T>(
    /** 保存 Promise 的完成与拒绝入口，供后续事件调用。 */ (yes, no) => {
      resolve = yes
      reject = no
    },
  )
  // 调用方开始消费前两个流 Promise 都可能失败，提前注册拒绝处理。
  void promise.catch(/** 吸收提前发生的拒绝，调用方仍从原 Promise 接收错误。 */ () => {})
  return { promise, resolve, reject }
}
type Call = {
  /** 本轮请求快照，调用期间不受外部参数修改影响。 */
  params: StreamParams
  /** 启动帧已尝试发送；尚未确认受理时断开会归类为结果未知。 */
  sent: boolean
  /** 已收到服务端受理确认。 */
  accepted: boolean
  /** 调用方已取消，之后的增量与成功结果不再交给消费者。 */
  cancelled: boolean
  /** 本地消费已结束；已发送的取消请求可能仍占用活动槽位。 */
  ended: boolean
  /** 受理后向流式调用方返回增量流的 Promise 控制入口。 */
  started: ReturnType<typeof deferred<CompletionStream>>
  /** 流式调用的最终结果 Promise 控制入口。 */
  final: ReturnType<typeof deferred<Completion>>
  /** 尚未消费的文本增量，按到达顺序缓存。 */
  queue: Delta[]
  /** 迭代器等待新事件时登记的唤醒入口，每次唤醒后移除。 */
  wake?: () => void
  /** 当前轮次的终止错误，迭代器和最终结果共用。 */
  error?: AgentClientError
  /** 当前轮次唯一的流对象，内部限制只能迭代消费一次。 */
  stream: CompletionStream
  /** 清理外部 AbortSignal 监听器的入口。 */
  detachAbort: () => void
  /** 整轮调用的超时定时器，轮次释放时清除。 */
  timeout?: ReturnType<typeof setTimeout>
  /** 等待服务端取消确认的定时器，确认终态或断开时清除。 */
  cancelTimeout?: ReturnType<typeof setTimeout>
}
type ClientOptions = {
  /** 按需取得当前工程连接地址，避免固定使用旧工程 ID。 */
  url: () => string
  /** 可注入的连接工厂，测试时替换为受控 WebSocket。 */
  socketFactory?: (url: string) => WebSocket
  /** 业务空闲关闭期限，默认三分钟；心跳不会重置此期限。 */
  idleMs?: number
  /** 心跳发送间隔，默认三十秒。 */
  heartbeatMs?: number
  /** 心跳响应等待期限，默认十五秒。 */
  heartbeatTimeoutMs?: number
  /** WebSocket 握手期限，默认十五秒。 */
  connectTimeoutMs?: number
  /** 客户端整轮调用期限，默认十一分钟，覆盖服务端十分钟期限。 */
  callTimeoutMs?: number
  /** 取消后等待服务端清理的期限，默认十五秒。 */
  cancelTimeoutMs?: number
}

/**
 * 工程范围内的单调用客户端，对外只提供流式调用接口。
 *
 * 前端流式调用路径：
 * 1. client.stream(params, { signal }) 同步检查准入、复制请求、占用调用槽并准备
 *    队列与两个 Promise，通过 makeStream() 创建流对象，再启动 sendStart()。
 * 2. sendStart() -> ensureConnected()，复用已有连接或共享握手 Promise；连接就绪且
 *    本轮仍有效时 socket.send("turn.start")。
 * 3. 当前 WebSocket 的 message 监听器 -> receive()，校验协议版本及 turnId。
 *    turn.started 完成 call.started，使 await client.stream() 返回流对象；
 *    text.delta 写入 call.queue 并唤醒迭代器，提前到达的增量也会缓存在队列中。
 * 4. 调用方 for await 消费 makeStream() 的迭代器：队列有片段就 yield，未结束且没有
 *    片段时等待 receive() 唤醒；增量仅用于更新 draft，不作为最终成功结果。
 * 5. 合法 turn.completed 完成 call.final 并唤醒迭代器，release() 释放调用槽。
 *    流排空队列后正常结束；output.finalCompletion() 读取同一 Promise 中的完整回复
 *    和 usage，不再发起模型调用。模块复核账号、工程及调用归属后提交完整结果。
 * 6. 失败、断线或取消通过 fail() 拒绝流与最终结果；signal 取消或提前退出迭代
 *    -> cancel()，已发送时发出 turn.cancel，保留槽位直到服务端终态或连接清理。
 *    release() 只清理本轮资源，WS 继续复用；无活动调用时 scheduleIdle() 计时关闭。
 */
export class AgentClient {
  // 最新的冻结状态快照，所有订阅方共享读取，更新时整体替换。
  private state: ConnectionState = Object.freeze({
    status: 'disconnected',
    closeReason: null,
    error: null,
  })
  // 连接状态订阅集合，取消订阅或销毁客户端时移除。
  private listeners = new Set<(state: ConnectionState) => void>()
  // 明确身份失效的订阅集合，普通握手失败不会触发这些监听器。
  private identityListeners = new Set<() => void>()
  // 当前有效连接；清理时先移除引用，使旧连接的迟到事件失效。
  private socket?: WebSocket
  // 正在握手的共享 Promise，等待连接的调用复用同一次握手。
  private connecting?: ReturnType<typeof deferred<void>>
  // 唯一活动调用槽位；取消已发送请求后仍保留到终态或清理超时。
  private active?: Call
  // 无活动调用时的业务空闲关闭定时器。
  private idle?: ReturnType<typeof setTimeout>
  // 当前连接的周期心跳定时器，关闭连接时清除。
  private heartbeat?: ReturnType<typeof setInterval>
  // 已发送心跳的响应超时定时器，收到 pong 后清除。
  private heartbeatTimeout?: ReturnType<typeof setTimeout>
  // 当前握手的超时定时器，连接打开或清理时清除。
  private connectTimeout?: ReturnType<typeof setTimeout>

  /** 保存连接工厂和超时配置，首次调用时才建立 WebSocket。 */
  constructor(private readonly options: ClientOptions) {}
  /** 返回冻结的连接状态快照，防止订阅方修改内部状态。 */
  get connectionState(): ConnectionState {
    return this.state
  }
  /** 订阅连接状态并立即推送当前值，返回用于取消订阅的函数。 */
  subscribeConnection(listener: (state: ConnectionState) => void) {
    this.listeners.add(listener)
    listener(this.state)
    return /** 移除当前连接状态订阅。 */ () => {
      this.listeners.delete(listener)
    }
  }
  /** 订阅服务端明确发出的身份失效通知，返回取消订阅函数。 */
  subscribeIdentityInvalid(listener: () => void) {
    this.identityListeners.add(listener)
    return /** 移除当前身份失效订阅。 */ () => {
      this.identityListeners.delete(listener)
    }
  }
  /** 合并并冻结状态快照，向所有连接状态订阅方广播。 */
  private update(patch: Partial<ConnectionState>) {
    this.state = Object.freeze({ ...this.state, ...patch })
    for (const listener of this.listeners) listener(this.state)
  }
  /** 根据是否发送及是否确认受理，构造具有确定受理分类的错误。 */
  private error(code: string, call = this.active) {
    return new AgentClientError(
      code,
      call?.params.turnId,
      call?.accepted ? 'accepted' : call?.sent ? 'unknown' : 'not_accepted',
    )
  }

  /**
   * 调用入口：同步占用槽位、复制参数，通过 makeStream() 准备增量消费和最终结果入口。
   * sendStart() 按需连接并发送 turn.start；本函数只返回等待受理的 call.started.promise，
   * receive() 收到 turn.started 后才交付流对象，完整结果由 finalCompletion() 单独读取。
   */
  stream(params: StreamParams, options: { signal?: AbortSignal } = {}): Promise<CompletionStream> {
    // 在等待连接前同步拒绝并发调用，不建立隐式请求队列。
    if (this.state.status === 'disposed') throw this.error('CLIENT_DISPOSED')
    if (this.active) throw new AgentClientError('MODEL_CALL_BUSY', params.turnId, 'not_accepted')
    if (options.signal?.aborted)
      throw new AgentClientError('TURN_CANCELLED', params.turnId, 'not_accepted')
    const snapshot = structuredClone(params)
    clearTimeout(this.idle)
    const call: Call = {
      params: snapshot,
      sent: false,
      accepted: false,
      cancelled: false,
      ended: false,
      started: deferred<CompletionStream>(),
      final: deferred<Completion>(),
      queue: [],
      detachAbort: /** 未注册取消监听器时提供可安全调用的空清理函数。 */ () => {},
      stream: undefined as unknown as CompletionStream,
    }
    call.stream = this.makeStream(call)
    this.active = call
    const abort = /** 将外部取消信号转交当前轮次。 */ () => this.cancel(call)
    options.signal?.addEventListener('abort', abort, { once: true })
    call.detachAbort = /** 释放轮次时移除外部取消信号监听器。 */ () =>
      options.signal?.removeEventListener('abort', abort)
    call.timeout = setTimeout(
      /** 调用超过期限且仍占用槽位时关闭连接。 */
      () => {
        if (this.active === call) this.close('MODEL_CALL_TIMEOUT')
      },
      this.options.callTimeoutMs ?? 11 * 60 * 1000,
    )
    void this.sendStart(call).catch(
      /** 将启动失败转换为客户端错误，并释放当前轮次。 */ (error) => {
        if (this.active !== call) return
        this.fail(
          call,
          error instanceof AgentClientError ? error : this.error('CONNECTION_FAILED', call),
        )
        this.release(call)
      },
    )
    return call.started.promise
  }

  /**
   * 由 stream() 在发送前创建流对象；迭代器读取 receive() 写入的 queue，空队列等待 wake。
   * 成功终态到达后排空队列并结束，失败时抛错；只允许消费一次，提前退出会调用 cancel()。
   * finalCompletion() 直接读取 call.final.promise，允许重复读取，不创建新调用。
   */
  private makeStream(call: Call): CompletionStream {
    // 此流对象跨迭代器请求共享的消费标记，防止重复读取同一增量队列。
    let consumed = false
    const consumedError = /** 为重复消费构造包含轮次信息的错误。 */ () =>
      this.error('STREAM_ALREADY_CONSUMED', call)
    const cancel = /** 在消费者提前退出时取消当前轮次。 */ () => this.cancel(call)
    return {
      finalCompletion: /** 读取由成功终态完成的共享结果 Promise，不重新连接或调用模型。 */ () =>
        call.final.promise,
      /** 申请唯一消费权，返回按顺序读取缓存增量的异步迭代器。 */
      [Symbol.asyncIterator]() {
        if (consumed) throw consumedError()
        consumed = true
        return /** 依次产出缓存增量，等待新事件，并在提前退出时触发取消。 */ (async function* () {
          try {
            for (;;) {
              if (call.error) throw call.error
              const chunk = call.queue.shift()
              if (chunk) {
                yield chunk
                continue
              }
              if (call.ended) {
                await call.final.promise
                return
              }
              await new Promise<void>(
                /** 登记消费者的唤醒入口，由新增量或终态事件恢复迭代。 */ (resolve) => {
                  call.wake = resolve
                },
              )
            }
          } finally {
            if (!call.ended) cancel()
          }
        })()
      },
    }
  }

  /**
   * 由 stream() 启动，先 ensureConnected() 等待连接，再核对槽位和取消状态后发送 turn.start。
   * 本轮队列和事件处理已准备好，受理和增量立即返回也不会丢失；发送异常由 stream() 收口。
   */
  private async sendStart(call: Call) {
    await this.ensureConnected()
    if (this.active !== call || call.cancelled) return
    const { params } = call
    // 发送前已安装轮次和缓冲区，受理事件与增量可能立即到达。
    const frame = JSON.stringify({
      type: 'turn.start',
      protocol_version: AGENT_PROTOCOL_VERSION,
      turn_id: params.turnId,
      task_id: params.taskId,
      project_id: params.projectId,
      messages: params.messages,
    })
    call.sent = true
    this.socket!.send(frame)
  }

  /**
   * 由 sendStart() 调用：已连接则直接继续，握手中则复用同一 Promise，否则创建 WebSocket。
   * open 完成握手并启动心跳；message 进入 receive()；error/close 清理连接与所属调用。
   * 所有监听器核对当前 socket，旧连接的迟到事件不能影响新连接或新轮次。
   */
  private ensureConnected(): Promise<void> {
    if (this.socket?.readyState === 1) return Promise.resolve()
    if (this.connecting) return this.connecting.promise
    const pending = deferred<void>()
    this.connecting = pending
    this.update({ status: 'connecting', error: null })
    let socket: WebSocket
    try {
      socket = (
        this.options.socketFactory ??
        /** 使用浏览器原生 WebSocket 建立默认连接。 */ ((url) => new WebSocket(url))
      )(this.options.url())
    } catch {
      this.connecting = undefined
      pending.reject(this.error('CONNECTION_FAILED'))
      this.update({ status: 'disconnected', error: 'CONNECTION_FAILED' })
      return pending.promise
    }
    this.socket = socket
    this.connectTimeout = setTimeout(
      /** 握手超时且连接仍为当前实例时关闭连接。 */ () => {
        if (this.socket === socket) this.close('CONNECTION_TIMEOUT')
      },
      this.options.connectTimeoutMs ?? 15000,
    )
    socket.addEventListener(
      'open',
      /** 完成当前连接的握手，启动心跳和空闲计时。 */ () => {
        if (this.socket !== socket) return
        clearTimeout(this.connectTimeout)
        this.connecting = undefined
        this.update({ status: 'connected', closeReason: null, error: null })
        pending.resolve()
        this.startHeartbeat(socket)
        this.scheduleIdle()
      },
    )
    socket.addEventListener(
      'message',
      /** 仅将当前连接收到的消息交给协议处理器。 */ (event) => {
        if (this.socket === socket) this.receive(event.data)
      },
    )
    socket.addEventListener(
      'error',
      /** 将当前连接的传输错误转换为连接失败。 */ () => {
        if (this.socket === socket) this.close('CONNECTION_FAILED')
      },
    )
    socket.addEventListener(
      'close',
      /** 识别身份失效关闭码，或按断开原因清理当前连接。 */ (event) => {
        if (this.socket !== socket) return
        if (event.code === 4001) {
          this.identityInvalid()
          return
        }
        this.close(event.reason || 'CONNECTION_LOST')
      },
    )
    return pending.promise
  }

  /** 周期发送心跳并检测响应超时，心跳不延长业务空闲时间。 */
  private startHeartbeat(socket: WebSocket) {
    this.heartbeat = setInterval(
      /** 没有待确认心跳时发送探测，并安排响应超时检查。 */ () => {
        if (this.socket !== socket || this.heartbeatTimeout) return
        this.heartbeatTimeout = setTimeout(
          /** 心跳未在期限内确认时关闭连接。 */
          () => this.close('HEARTBEAT_TIMEOUT'),
          this.options.heartbeatTimeoutMs ?? 15000,
        )
        try {
          socket.send('agent.ping')
        } catch {
          this.close('CONNECTION_LOST')
        }
      },
      this.options.heartbeatMs ?? 30000,
    )
  }
  /**
   * 由当前 WebSocket 的 message 监听器调用，校验版本及轮次，其他轮次事件直接忽略。
   * turn.started -> 完成受理 Promise；text.delta -> 入队并唤醒 makeStream() 的迭代器；
   * turn.completed -> 完成最终结果并 release()；失败终态 -> fail() 后 release()。
   * 协议异常关闭连接，明确身份失效另行通知模块；取消后的迟到成功只结束内部收口。
   */
  private receive(raw: unknown) {
    if (raw === 'agent.pong') {
      clearTimeout(this.heartbeatTimeout)
      this.heartbeatTimeout = undefined
      return
    }
    let v: Record<string, unknown>
    try {
      const parsed: unknown = typeof raw === 'string' ? JSON.parse(raw) : null
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error()
      v = parsed as Record<string, unknown>
    } catch {
      this.close('PROTOCOL_INVALID')
      return
    }
    if (v.protocol_version !== AGENT_PROTOCOL_VERSION) {
      this.close('PROTOCOL_VERSION_UNSUPPORTED')
      return
    }
    if (v.type === 'identity.invalid' && v.turn_id === undefined) {
      this.identityInvalid()
      return
    }
    const call = this.active
    if (!call || v.turn_id !== call.params.turnId) return
    switch (v.type) {
      case 'turn.started':
        if (!call.sent) {
          this.close('PROTOCOL_INVALID')
          return
        }
        call.accepted = true
        if (!call.cancelled) call.started.resolve(call.stream)
        return
      case 'text.delta':
        if (!call.accepted || typeof v.delta !== 'string') {
          this.close('PROTOCOL_INVALID')
          return
        }
        if (!call.cancelled) {
          call.queue.push({ delta: v.delta })
          call.wake?.()
          call.wake = undefined
        }
        return
      case 'turn.completed': {
        const message = v.message as Record<string, unknown> | null
        const usage = v.usage as Record<string, unknown> | null
        if (
          !call.accepted ||
          !message ||
          message.role !== 'assistant' ||
          typeof message.content !== 'string' ||
          !message.content.trim() ||
          Object.keys(message).some(
            /** 检测最终消息是否包含协议未定义的字段。 */ (key) =>
              !['role', 'content'].includes(key),
          ) ||
          (usage !== null &&
            (!usage ||
              !['inputTokens', 'outputTokens', 'totalTokens'].every(
                /** 逐项验证最终用量为非负安全整数。 */
                (key) => Number.isSafeInteger(usage[key]) && Number(usage[key]) >= 0,
              ) ||
              Number(usage.totalTokens) !== Number(usage.inputTokens) + Number(usage.outputTokens)))
        ) {
          this.close('PROTOCOL_INVALID')
          return
        }
        if (!call.cancelled) {
          call.ended = true
          call.final.resolve({
            turnId: call.params.turnId,
            message: message as Completion['message'],
            usage: usage as Completion['usage'],
          })
          call.wake?.()
        }
        this.release(call)
        return
      }
      case 'request.rejected':
        if (typeof v.code !== 'string' || call.accepted) {
          this.close('PROTOCOL_INVALID')
          return
        }
        this.fail(call, new AgentClientError(v.code, call.params.turnId, 'not_accepted'))
        this.release(call)
        return
      case 'turn.failed':
      case 'turn.cancelled':
        if (!call.accepted || typeof v.code !== 'string') {
          this.close('PROTOCOL_INVALID')
          return
        }
        this.fail(call, this.error(v.code, call))
        this.release(call)
        return
      case 'turn.status':
        if (
          v.duplicate === true ||
          ['completed', 'failed', 'cancelled', 'not_found'].includes(String(v.status))
        ) {
          this.fail(call, this.error('TURN_ALREADY_EXISTS', call))
          this.release(call)
        } else if (!['running', 'cancelling'].includes(String(v.status)))
          this.close('PROTOCOL_INVALID')
        return
      default:
        this.close('PROTOCOL_INVALID')
    }
  }

  /** 关闭失效身份的连接，并通知业务模块阻止后续调用。 */
  private identityInvalid() {
    this.close('IDENTITY_INVALID')
    for (const listener of this.identityListeners) listener()
  }
  /** 拒绝流入口及最终结果，清空临时增量并唤醒等待中的消费者。 */
  private fail(call: Call, error: AgentClientError) {
    if (call.ended) return
    call.ended = true
    call.error = error
    call.queue.length = 0
    call.started.reject(error)
    call.final.reject(error)
    call.wake?.()
    call.wake = undefined
  }
  /** 立即取消本地消费；已发送的请求保留槽位，等待服务端终态或清理超时。 */
  private cancel(call: Call) {
    if (this.active !== call || call.cancelled || call.ended) return
    call.cancelled = true
    this.fail(call, this.error('TURN_CANCELLED', call))
    if (!call.sent) {
      this.release(call)
      return
    }
    try {
      this.socket?.send(
        JSON.stringify({
          type: 'turn.cancel',
          protocol_version: AGENT_PROTOCOL_VERSION,
          turn_id: call.params.turnId,
        }),
      )
    } catch {
      this.close('CONNECTION_LOST')
      return
    }
    call.cancelTimeout = setTimeout(
      /** 服务端迟迟未确认取消时关闭连接并释放占用。 */ () => {
        if (this.active === call) this.close('CANCEL_TIMEOUT')
      },
      this.options.cancelTimeoutMs ?? 15000,
    )
  }
  /**
   * 终态或本地清理后移除本轮取消监听与定时器，释放所属槽位，再调用 scheduleIdle()。
   * 不关闭共享 WS，也不清除已交付流中的成功结果和待消费增量，下一轮可复用连接。
   */
  private release(call: Call) {
    call.detachAbort()
    clearTimeout(call.timeout)
    clearTimeout(call.cancelTimeout)
    if (this.active === call) {
      this.active = undefined
      this.scheduleIdle()
    }
  }
  /** 仅在已连接且没有活动调用时安排空闲关闭。 */
  private scheduleIdle() {
    clearTimeout(this.idle)
    if (this.active || this.state.status !== 'connected') return
    this.idle = setTimeout(
      /** 业务空闲期限到达且无活动调用时关闭连接。 */ () => {
        if (!this.active) this.close('IDLE_TIMEOUT')
      },
      this.options.idleMs ?? 180000,
    )
  }
  /** 关闭连接、终止握手和当前轮次，并清理全部连接定时器。 */
  close(reason = 'CLIENT_CLOSED') {
    if (this.state.status === 'disposed') return
    const socket = this.socket
    this.socket = undefined
    this.connecting?.reject(this.error(reason))
    this.connecting = undefined
    clearTimeout(this.connectTimeout)
    clearTimeout(this.idle)
    clearInterval(this.heartbeat)
    clearTimeout(this.heartbeatTimeout)
    this.heartbeatTimeout = undefined
    if (this.active) {
      this.fail(this.active, this.error(reason))
      this.release(this.active)
    }
    clearTimeout(this.idle)
    if (socket && socket.readyState < 2) socket.close(1000, reason)
    this.update({
      status: 'disconnected',
      closeReason: reason,
      error: ['CLIENT_CLOSED', 'IDLE_TIMEOUT', 'PAGE_LEFT', 'IDENTITY_CHANGED'].includes(reason)
        ? null
        : reason,
    })
  }
  /** 永久销毁客户端，关闭连接并释放订阅，之后禁止再次调用。 */
  dispose() {
    if (this.state.status === 'disposed') return
    this.close('CLIENT_DISPOSED')
    this.update({ status: 'disposed' })
    this.listeners.clear()
    this.identityListeners.clear()
  }
}
