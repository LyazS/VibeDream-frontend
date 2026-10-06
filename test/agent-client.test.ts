import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  AgentClient,
  AGENT_PROTOCOL_VERSION,
  type CompletionStream,
} from '../src/aipanel/agent/transport/AgentClient'

class Socket extends EventTarget {
  // 模拟原生连接状态，供客户端判断握手是否完成或连接是否已关闭。
  readyState = 0
  // 当前连接发出的原始帧记录，用于断言启动、取消和心跳行为。
  sent: string[] = []
  /** 记录客户端发出的原始帧，供测试检查。 */
  send(data: string) {
    this.sent.push(data)
  }
  /** 模拟握手成功并发送连接打开事件。 */
  open() {
    this.readyState = 1
    this.dispatchEvent(new Event('open'))
  }
  /** 补齐版本和轮次字段，模拟服务端业务事件。 */
  frame(type: string, fields: Record<string, unknown> = {}, turnId = 'turn-1') {
    this.raw(
      JSON.stringify({
        type,
        protocol_version: AGENT_PROTOCOL_VERSION,
        turn_id: turnId,
        ...fields,
      }),
    )
  }
  /** 模拟服务端发送原始文本消息。 */
  raw(data: string) {
    this.dispatchEvent(new MessageEvent('message', { data }))
  }
  /** 模拟连接关闭，保留关闭码和原因供客户端处理。 */
  close(code = 1000, reason = '') {
    this.readyState = 3
    this.dispatchEvent(Object.assign(new Event('close'), { code, reason }))
  }
}
// 每个用例共用的合法请求模板，特殊场景通过复制并覆盖字段构造。
const params = {
  turnId: 'turn-1',
  taskId: 'task-1',
  messages: [
    { role: 'system' as const, content: 'caller prompt' },
    { role: 'user' as const, content: 'hello' },
  ],
  projectId: 'project-1',
}
// 当前用例创建的模拟连接，在 beforeEach 中重置以隔离连接代次。
let sockets: Socket[]
// 当前用例创建的客户端，afterEach 统一销毁以避免定时器或监听残留。
let clients: AgentClient[]
/** 创建受控连接的客户端，并登记实例以便用例结束清理。 */
function client(options = {}) {
  const c = new AgentClient({
    url: /** 提供固定的测试连接地址。 */ () => 'ws://localhost/api/agent/ws',
    socketFactory: /** 创建并记录模拟 WebSocket，供测试主动驱动事件。 */ () => {
      const s = new Socket()
      sockets.push(s)
      return s as unknown as WebSocket
    },
    ...options,
  })
  clients.push(c)
  return c
}
/** 等待握手后的微任务完成，使启动帧发送可被观察。 */
async function flush() {
  await Promise.resolve()
  await Promise.resolve()
}
/** 发起流式调用并模拟握手及受理，返回可消费的流。 */
async function started(c: AgentClient, signal?: AbortSignal): Promise<CompletionStream> {
  const promise = c.stream(params, { signal })
  sockets.at(-1)!.open()
  await flush()
  sockets.at(-1)!.frame('turn.started')
  return promise
}
/** 发送正常完成事件，支持指定目标轮次。 */
function complete(socket: Socket, turnId = 'turn-1') {
  socket.frame(
    'turn.completed',
    { message: { role: 'assistant', content: 'hello world' }, usage: null },
    turnId,
  )
}
beforeEach(
  /** 初始化虚拟时钟和当前用例的连接、客户端集合。 */ () => {
    vi.useFakeTimers()
    sockets = []
    clients = []
  },
)
afterEach(
  /** 销毁测试客户端并恢复真实时钟。 */ () => {
    clients.forEach(/** 释放单个客户端的连接、监听器和定时器。 */ (c) => c.dispose())
    vi.clearAllTimers()
    vi.useRealTimers()
  },
)

describe('project-scoped single-turn client', /** 组织工程范围内单轮客户端的协议和生命周期测试。 */ () => {
  it('forwards caller messages without a separate project context', /** 验证传输层原样发送调用方消息，工程只用于路由。 */ async () => {
    const c = client()
    await started(c)
    const frame = JSON.parse(sockets[0].sent[0])
    expect(frame).toMatchObject({
      protocol_version: 'agent-text-v2',
      project_id: 'project-1',
      messages: params.messages,
    })
    expect(frame).not.toHaveProperty('context')
    complete(sockets[0])
  })
  it('reserves the slot synchronously and buffers deltas before iteration', /** 验证同步占用槽位、提前到达增量的缓存及单消费者约束。 */ async () => {
    const c = client()
    const promise = c.stream(params)
    expect(
      /** 尝试第二次调用，验证同步并发拒绝。 */ () => c.stream({ ...params, turnId: 'two' }),
    ).toThrow('MODEL_CALL_BUSY')
    sockets[0].open()
    await flush()
    sockets[0].frame('turn.started')
    sockets[0].frame('text.delta', { delta: 'hello ' })
    sockets[0].frame('text.delta', { delta: 'world' })
    complete(sockets[0])
    const stream = await promise
    const chunks = []
    for await (const chunk of stream) chunks.push(chunk.delta)
    expect(chunks.join('')).toBe('hello world')
    expect(await stream.finalCompletion()).toBe(await stream.finalCompletion())
    expect(
      /** 尝试重复获取迭代器，验证流只允许消费一次。 */ () => stream[Symbol.asyncIterator](),
    ).toThrow('STREAM_ALREADY_CONSUMED')
    expect(JSON.parse(sockets[0].sent[0])).toMatchObject({
      project_id: 'project-1',
      turn_id: 'turn-1',
      task_id: 'task-1',
    })
  })
  it('returns the stream on acceptance and waits for the terminal result', /** 验证受理后可读取流，完整结果仍须等待成功终态。 */ async () => {
    const c = client()
    const promise = c.stream(params)
    sockets[0].open()
    await flush()
    sockets[0].frame('turn.started')
    const stream = await promise
    const finished = vi.fn()
    void stream.finalCompletion().then(/** 记录最终结果完成时机。 */ finished)
    sockets[0].frame('text.delta', { delta: 'partial' })
    const iterator = stream[Symbol.asyncIterator]()
    expect(await iterator.next()).toEqual({ value: { delta: 'partial' }, done: false })
    expect(finished).not.toHaveBeenCalled()
    complete(sockets[0])
    expect(await stream.finalCompletion()).toMatchObject({
      turnId: 'turn-1',
      message: { content: 'hello world' },
    })
    expect(await iterator.next()).toEqual({ value: undefined, done: true })
  })
  it('does not connect for an already-aborted request', /** 验证已取消的请求不会建立连接。 */ () => {
    const c = client()
    const controller = new AbortController()
    controller.abort()
    expect(
      /** 提交已取消信号的调用，检查同步取消错误。 */ () =>
        c.stream(params, { signal: controller.signal }),
    ).toThrow('TURN_CANCELLED')
    expect(sockets).toHaveLength(0)
  })
  it('cancels before send without cancelling another connection waiter', /** 验证发送前取消旧请求不会影响共享握手中的新请求。 */ async () => {
    const c = client()
    const controller = new AbortController()
    const old = c.stream(params, { signal: controller.signal })
    controller.abort()
    await expect(old).rejects.toMatchObject({ code: 'TURN_CANCELLED', acceptance: 'not_accepted' })
    const next = c.stream({ ...params, turnId: 'next' })
    expect(sockets).toHaveLength(1)
    sockets[0].open()
    await flush()
    expect(
      sockets[0].sent.filter(
        /** 筛选启动帧，确认取消请求没有被发送。 */ (s) => s.includes('turn.start'),
      ),
    ).toHaveLength(1)
    sockets[0].frame('turn.started', {}, 'next')
    complete(sockets[0], 'next')
    await (await next).finalCompletion()
  })
  it('cancels a sent request before started, retaining the slot through server cleanup', /** 验证发送后取消立即拒绝消费，但保留槽位直到服务端清理结束。 */ async () => {
    const c = client()
    const controller = new AbortController()
    const promise = c.stream(params, { signal: controller.signal })
    sockets[0].open()
    await flush()
    controller.abort()
    await expect(promise).rejects.toMatchObject({ code: 'TURN_CANCELLED', acceptance: 'unknown' })
    expect(JSON.parse(sockets[0].sent.at(-1)!)).toMatchObject({ type: 'turn.cancel' })
    expect(/** 取消尚未确认时尝试新调用，验证槽位仍被占用。 */ () => c.stream(params)).toThrow(
      'MODEL_CALL_BUSY',
    )
    sockets[0].frame('turn.started')
    sockets[0].frame('turn.status', { status: 'cancelling' })
    expect(/** 收到取消中的状态后再次验证新调用仍被拒绝。 */ () => c.stream(params)).toThrow(
      'MODEL_CALL_BUSY',
    )
    complete(sockets[0])
    const next = c.stream({ ...params, turnId: 'next' })
    await flush()
    sockets[0].frame('turn.started', {}, 'next')
    complete(sockets[0], 'next')
    await (await next).finalCompletion()
  })
  it('consumer break sends cancel and rejects finalCompletion', /** 验证提前退出迭代会发送取消帧并拒绝最终结果。 */ async () => {
    const c = client()
    const stream = await started(c)
    sockets[0].frame('text.delta', { delta: 'draft' })
    for await (const chunk of stream) {
      expect(chunk.delta).toBe('draft')
      break
    }
    await expect(stream.finalCompletion()).rejects.toMatchObject({ code: 'TURN_CANCELLED' })
    expect(JSON.parse(sockets[0].sent.at(-1)!)).toMatchObject({ type: 'turn.cancel' })
    sockets[0].frame('turn.cancelled', { code: 'TURN_CANCELLED' })
  })
  it.each(['turn.failed', 'turn.cancelled'])(
    'rejects iteration and final result on %s',
    /** 验证失败或取消事件同时拒绝增量迭代与最终结果。 */
    async (type) => {
      const c = client()
      const stream = await started(c)
      sockets[0].frame('text.delta', { delta: 'partial' })
      sockets[0].frame(type, { code: 'TEST_FAILURE' })
      await expect(stream[Symbol.asyncIterator]().next()).rejects.toMatchObject({
        code: 'TEST_FAILURE',
        acceptance: 'accepted',
      })
      await expect(stream.finalCompletion()).rejects.toMatchObject({ code: 'TEST_FAILURE' })
    },
  )
  it('classifies an unacknowledged disconnect as unknown, without automatic replay', /** 验证未确认受理即断开时结果归类为未知，且不会自动重发。 */ async () => {
    const c = client()
    const promise = c.stream(params)
    sockets[0].open()
    await flush()
    sockets[0].close(1006)
    await expect(promise).rejects.toMatchObject({ code: 'CONNECTION_LOST', acceptance: 'unknown' })
    await vi.advanceTimersByTimeAsync(200000)
    expect(sockets).toHaveLength(1)
  })
  it('isolates old sockets and late turn frames from the next call', /** 验证旧连接及其他轮次的迟到事件不影响新调用。 */ async () => {
    const c = client()
    const stream = await started(c)
    complete(sockets[0])
    await stream.finalCompletion()
    c.close()
    const old = sockets[0]
    const next = c.stream({ ...params, turnId: 'next' })
    sockets[1].open()
    await flush()
    sockets[1].frame('turn.started', {}, 'next')
    old.close(1006)
    old.raw('{invalid')
    sockets[1].frame('turn.failed', { code: 'OLD' })
    complete(sockets[1], 'next')
    expect((await (await next).finalCompletion()).turnId).toBe('next')
  })
  it('closes after 3 business-idle minutes, ignoring heartbeats, and reconnects on demand', /** 验证心跳不延长业务空闲时间，空闲关闭后可按需重新连接。 */ async () => {
    const c = client()
    const stream = await started(c)
    complete(sockets[0])
    await stream.finalCompletion()
    for (let i = 0; i < 5; i++) {
      await vi.advanceTimersByTimeAsync(30000)
      sockets[0].raw('agent.pong')
    }
    await vi.advanceTimersByTimeAsync(30000)
    expect(c.connectionState).toMatchObject({ status: 'disconnected', closeReason: 'IDLE_TIMEOUT' })
    expect(sockets).toHaveLength(1)
    const next = c.stream(params)
    sockets[1].open()
    await flush()
    sockets[1].frame('turn.started')
    complete(sockets[1])
    await (await next).finalCompletion()
  })
  it('does not idle-close while waiting for output', /** 验证等待模型输出期间不会因业务空闲而关闭连接。 */ async () => {
    const c = client({ heartbeatMs: 600000 })
    const stream = await started(c)
    await vi.advanceTimersByTimeAsync(200000)
    expect(c.connectionState.status).toBe('connected')
    complete(sockets[0])
    await stream.finalCompletion()
  })
  it('reports explicit identity invalidation even while idle', /** 验证空闲连接收到专用关闭码时也通知身份失效。 */ async () => {
    const c = client()
    const callback = vi.fn()
    c.subscribeIdentityInvalid(callback)
    const stream = await started(c)
    complete(sockets[0])
    await stream.finalCompletion()
    sockets[0].close(4001, 'Session revoked')
    expect(callback).toHaveBeenCalledOnce()
    expect(c.connectionState.closeReason).toBe('IDENTITY_INVALID')
  })
  it('keeps handshake failures distinct from identity invalidation', /** 验证握手失败不会误报为明确的身份失效。 */ async () => {
    const c = client()
    const callback = vi.fn()
    c.subscribeIdentityInvalid(callback)
    const p = c.stream(params)
    sockets[0].dispatchEvent(new Event('error'))
    await expect(p).rejects.toMatchObject({ acceptance: 'not_accepted' })
    expect(callback).not.toHaveBeenCalled()
  })
  it('times out cancellation cleanup and allows future on-demand connection', /** 验证取消清理超时会断开连接并释放调用。 */ async () => {
    const c = client()
    const controller = new AbortController()
    const stream = await started(c, controller.signal)
    controller.abort()
    await expect(stream.finalCompletion()).rejects.toThrow('TURN_CANCELLED')
    await vi.advanceTimersByTimeAsync(15000)
    expect(c.connectionState.closeReason).toBe('CANCEL_TIMEOUT')
  })
  it('rejects malformed successful results and duplicate status without replaying a reply', /** 验证异常成功结果被拒绝，重复状态不会重放旧回复。 */ async () => {
    const c = client()
    let stream = await started(c)
    sockets[0].frame('turn.completed', {
      message: { role: 'assistant', content: 'partial', extra: true },
      usage: null,
    })
    await expect(stream.finalCompletion()).rejects.toThrow('PROTOCOL_INVALID')
    stream = await started(c)
    sockets[1].frame('turn.status', { status: 'completed', duplicate: true })
    await expect(stream.finalCompletion()).rejects.toThrow('TURN_ALREADY_EXISTS')
  })
  it('makes disposal final and exposes immutable connection state', /** 验证连接状态不可修改，客户端销毁后无法再次调用。 */ () => {
    const c = client()
    const callback = vi.fn()
    const unsubscribe = c.subscribeConnection(callback)
    expect(Object.isFrozen(c.connectionState)).toBe(true)
    unsubscribe()
    c.dispose()
    expect(callback).toHaveBeenCalledOnce()
    expect(/** 尝试调用已销毁客户端，检查同步销毁错误。 */ () => c.stream(params)).toThrow(
      'CLIENT_DISPOSED',
    )
  })
})
