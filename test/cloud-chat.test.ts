import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createRenderer, nextTick } from 'vue'
import { useCloudChat } from '../src/aipanel/agent/composables/useCloudChat'

const state = vi.hoisted(() => ({
  agents: [] as Array<{ name: string; disconnect: (code?: number) => void }>,
  requests: [] as Array<{ agent: string; messages: Array<{ role: string; parts: unknown[] }> }>,
  creations: 0,
  getRequests: 0,
  createGate: null as Promise<void> | null,
  holdNextResponse: false,
  rejectNextRequest: false,
  rejectNextConnection: false,
}))

vi.mock('@/config/apiCapabilities', () => ({ enabledApiCapabilities: new Set(['chat']) }))
vi.mock('@/core/unifiedStore', () => ({
  useUnifiedStore: () => ({ currentUser: { id: 'user-1' } }),
}))
vi.mock('@/utils/fetchClient', () => ({
  fetchClient: {
    get: async () => {
      state.getRequests += 1
      throw new Error('聊天不应请求模型配置')
    },
    post: async () => {
      state.creations += 1
      await state.createGate
      return { data: { conversation_id: 'conversation-1' } }
    },
  },
}))
vi.mock('agents/client', () => ({
  AgentClient: class extends EventTarget {
    name: string
    ready: Promise<void>
    readyState = 1

    constructor(options: { name: string }) {
      super()
      this.name = options.name
      this.ready = state.rejectNextConnection ? new Promise(() => {}) : Promise.resolve()
      if (state.rejectNextConnection) {
        state.rejectNextConnection = false
        queueMicrotask(() => this.disconnect(4001))
      }
      state.agents.push(this)
    }

    disconnect(code = 1006) {
      if (this.readyState === 3) return
      this.readyState = 3
      const event = new Event('close')
      Object.defineProperty(event, 'code', { value: code })
      this.dispatchEvent(event)
    }

    close() {
      this.disconnect(1000)
    }
  },
}))
vi.mock('agents/chat/transport', () => ({
  WebSocketChatTransport: class {
    constructor(private readonly options: { agent: EventTarget & { name: string } }) {}

    async sendMessages(options: { messages: Array<{ role: string; parts: unknown[] }> }) {
      state.requests.push({
        agent: this.options.agent.name,
        messages: structuredClone(options.messages),
      })
      const responseId = state.requests.length
      const hold = state.holdNextResponse
      state.holdNextResponse = false
      const reject = state.rejectNextRequest
      state.rejectNextRequest = false
      const agent = this.options.agent
      return new ReadableStream({
        start(controller) {
          if (reject) {
            controller.error(new Error('CHAT_REJECTED:聊天文本过长'))
            return
          }
          controller.enqueue({ type: 'start', messageId: `assistant-${responseId}` })
          controller.enqueue({ type: 'text-start', id: `text-${responseId}` })
          controller.enqueue({
            type: 'text-delta',
            id: `text-${responseId}`,
            delta: `reply ${responseId}`,
          })
          if (hold) {
            agent.addEventListener('close', () => controller.close(), { once: true })
          } else {
            controller.enqueue({ type: 'text-end', id: `text-${responseId}` })
            controller.enqueue({ type: 'finish', finishReason: 'stop' })
            controller.close()
          }
        },
      })
    }

    async reconnectToStream() {
      return null
    }
    cancelActiveServerTurn() {
      return false
    }
  },
}))

const renderer = createRenderer({
  patchProp() {},
  insert() {},
  remove() {},
  createElement: () => ({}),
  createText: () => ({}),
  createComment: () => ({}),
  setText() {},
  setElementText() {},
  parentNode: () => null,
  nextSibling: () => null,
})

function mountChat() {
  let cloudChat!: ReturnType<typeof useCloudChat>
  const app = renderer.createApp({
    setup() {
      cloudChat = useCloudChat()
      return () => null
    },
  })
  app.mount({})
  return { cloudChat, unmount: () => app.unmount() }
}

beforeEach(() => {
  state.agents.length = 0
  state.requests.length = 0
  state.creations = 0
  state.getRequests = 0
  state.createGate = null
  state.holdNextResponse = false
  state.rejectNextRequest = false
  state.rejectNextConnection = false
  vi.stubGlobal('location', {
    origin: 'https://preview.lightcut-editor.pages.dev',
    host: 'preview.lightcut-editor.pages.dev',
  })
})

afterEach(() => vi.unstubAllGlobals())

describe('cloud chat connection lifecycle', () => {
  it('sends text without fetching model configuration or enforcing a frontend length limit', async () => {
    const { cloudChat, unmount } = mountChat()
    try {
      await nextTick()
      expect(state.getRequests).toBe(0)
      const text = 'x'.repeat(16001)
      await cloudChat.send(text)
      expect(state.requests[0].messages[0].parts).toEqual([{ type: 'text', text }])
      expect(state.getRequests).toBe(0)
    } finally {
      unmount()
    }
  })

  it('restores a rejected draft and allows the next message', async () => {
    const { cloudChat, unmount } = mountChat()
    try {
      state.rejectNextRequest = true
      const onSubmitted = vi.fn()
      const onRejected = vi.fn()
      await cloudChat.send('too long', onSubmitted, onRejected)
      expect(onSubmitted).toHaveBeenCalledOnce()
      expect(onRejected).toHaveBeenCalledOnce()
      expect(cloudChat.errorText.value).toBe('聊天文本过长')
      expect(cloudChat.messages.value).toEqual([])

      await cloudChat.send('short')
      expect(state.requests).toHaveLength(2)
      expect(cloudChat.messages.value.map((message) => message.role)).toEqual(['user', 'assistant'])
    } finally {
      unmount()
    }
  })

  it('keeps submission pending while connecting and only enables stopping during a reply', async () => {
    let releaseCreate!: () => void
    state.createGate = new Promise<void>((resolve) => { releaseCreate = resolve })
    state.holdNextResponse = true
    const { cloudChat, unmount } = mountChat()
    try {
      const onSubmitted = vi.fn()
      const pending = cloudChat.send('first', onSubmitted)
      await vi.waitFor(() => expect(state.creations).toBe(1))
      expect(cloudChat.isConnecting.value).toBe(true)
      expect(cloudChat.isSending.value).toBe(false)
      expect(onSubmitted).not.toHaveBeenCalled()

      releaseCreate()
      await vi.waitFor(() => expect(state.requests).toHaveLength(1))
      expect(cloudChat.isConnecting.value).toBe(false)
      expect(cloudChat.isSending.value).toBe(true)
      expect(onSubmitted).toHaveBeenCalledOnce()

      state.agents[0].disconnect()
      await pending
    } finally {
      releaseCreate()
      unmount()
    }
  })

  it('silently reconnects the same conversation without losing completed messages', async () => {
    const { cloudChat, unmount } = mountChat()
    try {
      await cloudChat.send('first')
      await nextTick()
      expect(state.requests[0].messages.map((message) => message.role)).toEqual(['user'])
      expect(cloudChat.messages.value.map((message) => message.role)).toEqual(['user', 'assistant'])

      state.agents[0].disconnect()
      expect(cloudChat.errorText.value).toBe('')

      await cloudChat.send('second')
      await nextTick()
      expect(state.creations).toBe(1)
      expect(state.agents).toHaveLength(2)
      expect(state.requests[1].agent).toBe('conversation-1')
      expect(state.requests[1].messages.map((message) => message.role)).toEqual(['user'])
      expect(state.requests[1].messages[0].parts).toEqual([{ type: 'text', text: 'second' }])
      expect(cloudChat.messages.value.map((message) => message.role)).toEqual([
        'user',
        'assistant',
        'user',
        'assistant',
      ])
    } finally {
      unmount()
    }
  })

  it('keeps an interrupted turn visible and never resends it', async () => {
    const { cloudChat, unmount } = mountChat()
    try {
      state.holdNextResponse = true
      const pending = cloudChat.send('first')
      await vi.waitFor(() => expect(state.requests).toHaveLength(1))
      state.agents[0].disconnect()
      await pending
      expect(cloudChat.errorText.value).toContain('回复已中断')
      await cloudChat.send('second')
      expect(state.requests).toHaveLength(1)
      expect(state.agents).toHaveLength(1)
    } finally {
      unmount()
    }
  })

  it('shows an authentication error for a revoked session', async () => {
    const { cloudChat, unmount } = mountChat()
    try {
      await cloudChat.send('first')
      state.agents[0].disconnect(4001)
      expect(cloudChat.errorText.value).toBe('登录状态已失效，请重新登录。')
    } finally {
      unmount()
    }
  })

  it('fails promptly when authorization closes the connection before it is ready', async () => {
    const { cloudChat, unmount } = mountChat()
    try {
      state.rejectNextConnection = true
      const onSubmitted = vi.fn()
      await expect(cloudChat.send('first', onSubmitted)).rejects.toThrow('登录状态已失效')
      expect(onSubmitted).not.toHaveBeenCalled()
      expect(cloudChat.errorText.value).toBe('登录状态已失效，请重新登录。')
      expect(state.requests).toHaveLength(0)

      await cloudChat.send('first', onSubmitted)
      expect(onSubmitted).toHaveBeenCalledOnce()
      expect(state.requests).toHaveLength(1)
    } finally {
      unmount()
    }
  })
})
