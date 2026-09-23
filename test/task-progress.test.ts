import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { CloudflareTaskProgressClient } from '../src/core/utils/cloudflareTaskProgressClient'

const sockets: FakeWebSocket[] = []
let nextId = 0

class FakeWebSocket {
  static readonly CONNECTING = 0
  static readonly OPEN = 1
  static readonly CLOSED = 3

  readyState = FakeWebSocket.CONNECTING
  sent: string[] = []
  onopen: (() => void) | null = null
  onmessage: ((event: { data: string }) => void) | null = null
  onerror: (() => void) | null = null
  onclose: ((event: { code: number }) => void) | null = null

  constructor(readonly url: string) {
    sockets.push(this)
  }

  open(): void {
    this.readyState = FakeWebSocket.OPEN
    this.onopen?.()
  }

  message(data: string): void {
    this.onmessage?.({ data })
  }

  send(data: string): void {
    this.sent.push(data)
  }

  close(code = 1000): void {
    this.readyState = FakeWebSocket.CLOSED
    this.onclose?.({ code })
  }
}

function snapshot(revision: number, heartbeat: boolean): string {
  return JSON.stringify({
    type: 'task.snapshot', heartbeat,
    task: { task_id: 'task-001', capability: 'indexing', status: 'processing', revision },
  })
}

beforeEach(() => {
  sockets.length = 0
  nextId = 0
  vi.useFakeTimers()
  vi.stubGlobal('location', { origin: 'http://localhost:5173' })
  vi.stubGlobal('WebSocket', FakeWebSocket)
  vi.stubGlobal('crypto', { randomUUID: () => String(++nextId) })
})

afterEach(() => {
  vi.clearAllTimers()
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('task progress WebSocket heartbeat', () => {
  it('does not ping an older server that has not advertised heartbeat support', () => {
    const client = new CloudflareTaskProgressClient()
    const subscription = client.subscribe('task-001', 'tab-12345678')
    const socket = sockets[0]
    socket.open()
    socket.message(snapshot(1, false))
    vi.advanceTimersByTime(90_000)
    expect(socket.sent).toHaveLength(1)
    expect(socket.readyState).toBe(FakeWebSocket.OPEN)
    subscription.close()
  })

  it('keeps a quiet task connected with pong, then reconnects and resumes its revision on timeout', async () => {
    const client = new CloudflareTaskProgressClient()
    const subscription = client.subscribe('task-001', 'tab-12345678')
    const socket = sockets[0]
    socket.open()
    socket.message(snapshot(1, true))
    expect((await subscription.next(new AbortController().signal)).revision).toBe(1)

    vi.advanceTimersByTime(30_000)
    expect(socket.sent.at(-1)).toBe('task.ping')
    socket.message('task.pong')
    vi.advanceTimersByTime(30_000)
    expect(socket.sent.at(-1)).toBe('task.ping')
    expect(socket.readyState).toBe(FakeWebSocket.OPEN)

    vi.advanceTimersByTime(10_000)
    expect(socket.readyState).toBe(FakeWebSocket.CLOSED)
    vi.advanceTimersByTime(1_000)
    const reconnected = sockets[1]
    reconnected.open()
    expect(JSON.parse(reconnected.sent[0]).seen_revisions).toEqual({ 'task-001': 1 })
    reconnected.message(snapshot(2, true))
    expect((await subscription.next(new AbortController().signal)).revision).toBe(2)

    subscription.close()
    vi.advanceTimersByTime(90_000)
    expect(sockets).toHaveLength(2)
    expect(reconnected.sent).toHaveLength(1)
  })
})
