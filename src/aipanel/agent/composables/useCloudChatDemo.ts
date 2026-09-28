import { computed, nextTick, onBeforeUnmount, shallowRef, watch } from 'vue'
import { useChat } from '@ai-sdk/vue'
import { AgentClient } from 'agents/client'
import { WebSocketChatTransport } from 'agents/chat/transport'
import type { ChatTransport, UIMessage } from 'ai'
import { enabledApiCapabilities } from '@/config/apiCapabilities'
import { useUnifiedStore } from '@/core/unifiedStore'
import { fetchClient } from '@/utils/fetchClient'

export const cloudChatDemoEnabled = enabledApiCapabilities.has('chat-demo')
const CHAT_REJECTION_PREFIX = 'CHAT_REJECTED:'

const inactiveTransport: ChatTransport<UIMessage> = {
  async sendMessages() {
    throw new Error('聊天连接尚未就绪')
  },
  async reconnectToStream() {
    return null
  },
}

function connectionError(error: unknown): string {
  if (error && typeof error === 'object' && 'status' in error) {
    const status = (error as { status: number }).status
    if (status === 401 || status === 403) return '登录状态已失效，请重新登录。'
  }
  return error instanceof Error ? error.message : '聊天连接失败，请稍后再试。'
}

export function useCloudChatDemo() {
  const store = useUnifiedStore()
  const userId = computed(() => store.currentUser?.id || null)
  const conversationId = shallowRef<string | null>(null)
  const transport = shallowRef<WebSocketChatTransport | null>(null)
  const client = shallowRef<AgentClient | null>(null)
  const creating = shallowRef(false)
  const connectionStatus = shallowRef<'idle' | 'connecting' | 'connected' | 'disconnected'>('idle')
  const connectionMessage = shallowRef('')
  let createKey: string | null = null
  let generation = 0
  let turnInterrupted = false
  let stopRequested = false

  const chatTransport: ChatTransport<UIMessage> = {
    sendMessages: (options) => {
      const latest = options.messages[options.messages.length - 1]
      if (latest?.role !== 'user') throw new Error('聊天消息格式错误')
      return (transport.value || inactiveTransport).sendMessages({
        ...options,
        messages: [latest],
      })
    },
    reconnectToStream: (options) =>
      (transport.value || inactiveTransport).reconnectToStream(options),
  }

  const chat = useChat(() => ({
    id: conversationId.value || 'new-chat',
    transport: chatTransport,
  }))

  function clear(cancelServerTurn = true) {
    generation += 1
    if (cancelServerTurn) chat.stop()
    client.value?.close()
    client.value = null
    transport.value = null
    conversationId.value = null
    createKey = null
    creating.value = false
    connectionStatus.value = 'idle'
    connectionMessage.value = ''
    turnInterrupted = false
    stopRequested = false
    chat.messages.value = []
    chat.clearError()
  }

  watch(
    userId,
    (next, previous) => {
      if (next !== previous) clear()
    },
    { immediate: true },
  )
  onBeforeUnmount(() => clear(false))

  async function connect(id: string, currentGeneration: number): Promise<void> {
    const agent = new AgentClient({
      agent: 'ChatAgent',
      name: id,
      host: globalThis.location.host,
      shouldReconnectOnClose: () => false,
    })
    let rejectBeforeReady: ((error: Error) => void) | null = null
    const closedBeforeReady = new Promise<never>((_, reject) => {
      rejectBeforeReady = reject
    })
    agent.addEventListener('close', (event) => {
      rejectBeforeReady?.(
        new Error(event.code === 4001 ? '登录状态已失效，请重新登录。' : '聊天连接已断开'),
      )
      if (currentGeneration !== generation || client.value !== agent) return
      connectionStatus.value = 'disconnected'
      if (event.code === 4001) {
        connectionMessage.value = '登录状态已失效，请重新登录。'
      } else if (
        (chat.status.value === 'submitted' || chat.status.value === 'streaming') &&
        !stopRequested
      ) {
        turnInterrupted = true
        connectionMessage.value = '回复已中断，请刷新页面开始新对话。此条消息不会自动重发。'
      } else {
        connectionMessage.value = ''
      }
    })
    agent.addEventListener('error', () => {
      if (
        currentGeneration === generation &&
        client.value === agent &&
        (connectionStatus.value === 'connecting' || chat.status.value !== 'ready')
      ) {
        connectionMessage.value = '聊天连接失败，请稍后再试。'
      }
    })
    const previous = client.value
    client.value = agent
    previous?.close()
    connectionStatus.value = 'connecting'
    let timeoutId: ReturnType<typeof setTimeout> | undefined
    try {
      await Promise.race([
        agent.ready,
        closedBeforeReady,
        new Promise<never>((_, reject) => {
          timeoutId = setTimeout(() => reject(new Error('聊天连接超时')), 10000)
        }),
      ])
    } catch (error) {
      if (client.value === agent) {
        client.value = null
        connectionStatus.value = 'disconnected'
      }
      agent.close()
      throw error
    } finally {
      if (timeoutId) clearTimeout(timeoutId)
      rejectBeforeReady = null
    }
    if (currentGeneration !== generation) {
      agent.close()
      return
    }
    transport.value = new WebSocketChatTransport({ agent })
    connectionStatus.value = 'connected'
    connectionMessage.value = ''
    await nextTick()
  }

  async function send(text: string, onSubmitted?: () => void, onRejected?: () => void): Promise<void> {
    const content = text.trim()
    if (!content || creating.value || chat.status.value !== 'ready') return
    if (!userId.value) {
      connectionMessage.value = '请先登录后再发送消息。'
      return
    }
    if (turnInterrupted) {
      connectionMessage.value = '回复已中断，请刷新页面开始新对话。此条消息不会自动重发。'
      return
    }
    const currentGeneration = generation
    creating.value = true
    stopRequested = false
    connectionMessage.value = ''
    try {
      if (!conversationId.value) {
        createKey ||= crypto.randomUUID()
        const response = await fetchClient.post<{ conversation_id: string }>(
          `${globalThis.location.origin}/api/chat/conversations`,
          {},
          { headers: { 'Idempotency-Key': createKey } },
        )
        if (currentGeneration !== generation) return
        conversationId.value = response.data.conversation_id
        createKey = null
        await connect(response.data.conversation_id, currentGeneration)
      } else if (connectionStatus.value !== 'connected') {
        await connect(conversationId.value, currentGeneration)
      }
      if (currentGeneration !== generation) return
      if (connectionStatus.value !== 'connected') {
        throw new Error('聊天连接已断开，请重试发送。')
      }
      const pending = chat.sendMessage({ text: content })
      onSubmitted?.()
      await pending
      const error = chat.error.value
      if (error?.message.startsWith(CHAT_REJECTION_PREFIX)) {
        const messages = chat.messages.value
        const latest = messages[messages.length - 1]
        if (latest?.role === 'user' && latest.parts.length === 1 &&
          latest.parts[0]?.type === 'text' && latest.parts[0].text === content) {
          chat.messages.value = messages.slice(0, -1)
        }
        chat.clearError()
        connectionMessage.value = error.message.slice(CHAT_REJECTION_PREFIX.length)
        onRejected?.()
      }
    } catch (error) {
      if (currentGeneration === generation && !connectionMessage.value) {
        connectionMessage.value = connectionError(error)
      }
      throw error
    } finally {
      if (currentGeneration === generation) creating.value = false
    }
  }

  function stop() {
    stopRequested = true
    transport.value?.cancelActiveServerTurn()
    chat.stop()
  }

  const isConnecting = computed(() => creating.value && chat.status.value === 'ready')
  const isSending = computed(
    () => chat.status.value === 'submitted' || chat.status.value === 'streaming',
  )
  const errorText = computed(() =>
    !userId.value
      ? '请先登录后再发送消息。'
      : connectionMessage.value || (chat.error.value ? '模型回复失败，请重试。' : ''),
  )

  return {
    messages: chat.messages,
    isConnecting,
    isSending,
    errorText,
    send,
    stop,
    clear,
  }
}
