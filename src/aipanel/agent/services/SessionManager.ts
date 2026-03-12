import { ref } from 'vue'
import { fetchClient } from '@/utils/fetchClient'
import { generateChatMessageId } from '@/core/utils/idGenerator'
import { API_ENDPOINTS } from '@/aipanel/agent/services/apiTypes'
import type { CreateSessionResponse } from '@/aipanel/agent/services/apiTypes'
import { StreamChunkType, type StreamChunk } from '@/utils/streamTypes'
import type {
  ChatMessage,
  ChatMessageUser,
  ChatMessageAssistant,
  ChatMessageTool,
  ChatMessageAssistantContent,
  SessionSummary,
} from '@/aipanel/agent/types'
import {
  ChatMessageType,
  ChatMessageUserContentType,
  ChatMessageAssistantContentType,
  isAssistantMessage,
  isUserMessage,
  isToolMessage,
} from '@/aipanel/agent/types'
import { useEditSDK } from '@/aipanel/agent/composables/useEditSDK'
import { indexedDBService } from '@/core/storage/IndexedDBService'

export interface SessionInfo {
  sessionId: string
  createdAt: Date
  lastActivity: Date
}

/**
 * 会话数据（存储在 IndexedDB 中）
 */
interface SessionData {
  sessionId: string
  messages: ChatMessage[]
  createdAt: string
  updatedAt: string
}

export class SessionManager {
  // 当前会话ID（直接公开）
  public currentSessionId = ref<string | null>(null)

  // 消息列表状态（直接公开）
  public messages = ref<ChatMessage[]>([])

  // 会话状态（直接公开）
  public isLoading = ref(false)
  public sessionError = ref<string | null>(null)

  // 消息发送状态（直接公开）
  public isSending = ref(false)
  private currentAbortController: AbortController | null = null
  private currentAIMessageId: string | null = null

  // editSDK 实例（包含脚本执行和工具执行）
  private editSDK: ReturnType<typeof useEditSDK>

  constructor() {
    // 初始化 editSDK 实例
    this.editSDK = useEditSDK()
  }

  /**
   * 清空当前会话的消息（不创建新会话）
   */
  clearCurrentSession(): void {
    // 如果有进行中的消息请求，先中止
    if (this.currentAbortController) {
      this.currentAbortController.abort()
      console.log('中止了进行中的消息请求')
    }

    // 清空当前会话ID
    this.currentSessionId.value = null

    // 清空消息列表
    this.messages.value = []

    // 重置发送状态
    this.isSending.value = false
    this.currentAbortController = null
    this.currentAIMessageId = null

    // 重置错误状态
    this.sessionError.value = null

    console.log('当前会话状态已完全重置')
  }

  /**
   * 删除会话
   */
  async deleteSession(sessionId: string): Promise<void> {
    try {
      console.log(`删除会话: ${sessionId}`)

      // 删除本地存储
      await this.deleteSessionFromDB(sessionId)

      // 可选：通知后端删除（如果需要）
      // await fetchClient.delete(API_ENDPOINTS.deleteSession(sessionId))

      // 如果删除的是当前会话，清空当前会话ID
      if (this.currentSessionId.value === sessionId) {
        this.currentSessionId.value = null
      }

      console.log(`会话删除成功: ${sessionId}`)
    } catch (error) {
      console.error(`删除会话失败: ${sessionId}`, error)
      throw new Error(`删除会话失败: ${error instanceof Error ? error.message : '未知错误'}`)
    }
  }

  /**
   * 中止当前正在发送的消息
   */
  abortCurrentMessage(): void {
    if (this.currentAbortController) {
      this.currentAbortController.abort()
      this.currentAbortController = null
      this.isSending.value = false
      console.log('当前消息已中止')
    }
  }

  /**
   * 处理流式JSON消息
   * 返回 ChatMessage 表示需要继续处理（如工具结果需要发送回后端）
   */
  private async handleStreamMessage(message: StreamChunk): Promise<ChatMessage | undefined> {
    switch (message.type) {
      case StreamChunkType.TEXT:
        await this.handleTextMessage(message.content)
        break
      case StreamChunkType.TOOL_CALL:
        return await this.handleToolCallMessage(message)
      case StreamChunkType.TASK_COMPLETE:
        await this.handleTaskComplete(message)
        break
      case StreamChunkType.ERROR:
        await this.handleErrorMessage(message.content)
        break
      default:
        console.warn('未知的消息类型:', message.type)
        break
    }
  }

  /**
   * 处理文本消息
   */
  private async handleTextMessage(content: string): Promise<void> {
    // 实时更新AI消息内容
    const currentMessage = this.messages.value.find((msg) => msg.id === this.currentAIMessageId) as
      | ChatMessageAssistant
      | undefined
    if (currentMessage && isAssistantMessage(currentMessage)) {
      // 查找最后一个文本片段，如果没有则创建新的文本片段
      const lastContent = currentMessage.content[currentMessage.content.length - 1]
      if (lastContent && lastContent.type === ChatMessageAssistantContentType.TEXT) {
        lastContent.content += content
      } else {
        currentMessage.content.push({
          type: ChatMessageAssistantContentType.TEXT,
          content: content,
        })
      }
    }
  }
  /**
   * 处理工具调用消息
   * 判断是前端工具还是后端工具，执行相应操作
   */
  private async handleToolCallMessage(message: StreamChunk): Promise<ChatMessageTool | undefined> {
    const { tool_name, tool_args, tool_call_id, is_frontend_tool } = message

    if (!tool_name) {
      console.warn('工具调用消息缺少 tool_name')
      return undefined
    }

    console.log(`收到工具调用: ${tool_name}`, tool_args, `is_frontend_tool: ${is_frontend_tool}`)

    // 显示工具调用信息（让用户知道调用了工具）
    this.appendAssistantContent({
      type: ChatMessageAssistantContentType.TOOL_USE,
      content: `${tool_name}(${JSON.stringify(tool_args || {})})`,
      // 工具调用专用字段
      toolName: tool_name,
      toolArgs: JSON.stringify(tool_args || {}, null, 2),
      isFrontendTool: is_frontend_tool ?? false,
    })

    // 判断是否为前端工具
    if (is_frontend_tool && this.editSDK.hasTool(tool_name)) {
      // 执行前端工具
      const result = await this.editSDK.executeTool(tool_name, tool_args || {})

      // 返回工具结果消息，用于继续对话
      const toolResultMessage: ChatMessageTool = {
        id: generateChatMessageId(ChatMessageType.TOOL),
        type: ChatMessageType.TOOL,
        tool_call_id: tool_call_id || '',
        content: result.success ? result.result : `工具执行失败: ${result.error}`,
        timestamp: new Date().toISOString(),
      }

      console.log(`前端工具执行完成: ${tool_name}`, toolResultMessage.content)
      return toolResultMessage
    }

    // 后端工具，不需要前端执行
    console.log(`工具 ${tool_name} 为后端工具，等待后端执行结果`)
    return undefined
  }

  /**
   * 向当前 AI 消息追加内容
   */
  private appendAssistantContent(content: ChatMessageAssistantContent): void {
    const currentMessage = this.messages.value.find((msg) => msg.id === this.currentAIMessageId) as
      | ChatMessageAssistant
      | undefined

    if (currentMessage && isAssistantMessage(currentMessage)) {
      currentMessage.content.push(content)
    }
  }
  /**
   * 处理错误消息
   */
  private async handleErrorMessage(content: string): Promise<void> {
    // 暂时简单的console输出错误信息
    console.error('AI通信错误:', content)
  }

  /**
   * 处理任务完成消息
   */
  private async handleTaskComplete(message: StreamChunk): Promise<void> {
    console.log('任务完成:', message.content)

    // 使用 TASK_COMPLETE 类型展示任务最终结果
    if (message.content) {
      this.appendAssistantContent({
        type: ChatMessageAssistantContentType.TASK_COMPLETE,
        content: message.content,
      })
    }
  }

  /**
   * 处理发送消息
   */
  async handleSendMessage(message: string): Promise<void> {
    // 检查是否有活跃会话，如果没有则创建新会话
    if (!this.currentSessionId.value) {
      try {
        console.log('没有活跃会话，创建新会话...')
        this.isLoading.value = true
        this.sessionError.value = null

        const response = await fetchClient.post<CreateSessionResponse>(API_ENDPOINTS.createSession)
        const sessionId = response.data.session_id

        // 保存当前会话ID
        this.currentSessionId.value = sessionId

        console.log(`会话创建成功: ${sessionId}`)
      } catch (error) {
        console.error('创建会话失败:', error)
        this.sessionError.value = error instanceof Error ? error.message : '创建会话失败'
        throw new Error(`创建会话失败: ${error instanceof Error ? error.message : '未知错误'}`)
      } finally {
        this.isLoading.value = false
      }
    }

    const sessionId = this.currentSessionId.value
    if (!sessionId) {
      throw new Error('无法获取会话信息')
    }

    // 设置发送状态
    this.isSending.value = true
    try {
      // 定义待发送消息（初始化为用户消息）
      let pendingMessage: ChatMessageUser | ChatMessageTool | undefined = {
        id: generateChatMessageId(ChatMessageType.USER),
        type: ChatMessageType.USER,
        content: [
          {
            type: ChatMessageUserContentType.TEXT,
            content: message,
          },
        ],
        timestamp: new Date().toISOString(),
      }

      while (pendingMessage) {
        this.currentAbortController = new AbortController()

        const messageToSend = pendingMessage

        // 如果是用户消息，添加到列表并创建助手消息占位符
        if (isUserMessage(messageToSend)) {
          this.messages.value.push(messageToSend)

          // 添加助手消息占位符
          this.currentAIMessageId = generateChatMessageId('assistant')
          const aiMessage: ChatMessage = {
            id: this.currentAIMessageId,
            type: ChatMessageType.ASSISTANT,
            content: [],
            timestamp: new Date().toISOString(),
          }
          this.messages.value.push(aiMessage)
        }

        console.log(`发送消息到会话: ${sessionId}`)
        console.log(`消息类型: ${messageToSend.type}`, messageToSend)

        // 重置 pendingMessage，如果流处理中没有产生工具消息，循环将结束
        pendingMessage = undefined

        // 使用 fetch 客户端处理流式响应
        await fetchClient.stream<StreamChunk>(
          'POST',
          API_ENDPOINTS.sendMessage,
          async (msg: StreamChunk) => {
            const result = await this.handleStreamMessage(msg)
            // console.log('收到流式JSON消息:', msg)

            // 只有工具调用消息才保存，用于下一次循环
            if (result && isToolMessage(result)) {
              pendingMessage = result
            }
          },
          {
            session_id: sessionId,
            message: messageToSend,
          },
          { signal: this.currentAbortController!.signal },
        )
      }
      // 响应完成
      console.log('AI响应完成')
      this.isSending.value = false

      // 保存会话到 IndexedDB
      await this.saveSessionToDB()
      console.log('会话已保存到本地存储')
    } catch (error) {
      console.error('发送消息失败:', error)

      let errorMessage = '发送消息失败'
      if (error instanceof Error) {
        errorMessage = error.message
      }

      throw error instanceof Error ? error : new Error(errorMessage)
    } finally {
      this.isSending.value = false
      this.currentAbortController = null
      this.currentAIMessageId = null
    }
  }

  /**
   * 恢复会话
   */
  async restoreSession(sessionId: string): Promise<void> {
    try {
      // 设置当前会话ID
      this.currentSessionId.value = sessionId

      console.log(`从本地存储恢复会话: ${sessionId}`)
      const sessionData = await this.getSessionFromDB(sessionId)

      if (!sessionData) {
        throw new Error('会话不存在')
      }

      // 更新消息列表
      this.messages.value = sessionData.messages

      console.log(`会话恢复成功: ${sessionId}, ${sessionData.messages.length} 条消息`)
    } catch (error) {
      console.error(`恢复会话失败: ${sessionId}`, error)
      this.messages.value = []
      throw new Error(`恢复会话失败: ${error instanceof Error ? error.message : '未知错误'}`)
    }
  }

  /**
   * 获取所有会话的摘要信息
   */
  async getAllSessions(): Promise<SessionSummary[]> {
    try {
      console.log('从本地存储获取会话列表...')
      const summaries = await this.getAllSessionsFromDB()
      console.log(`成功获取会话列表: ${summaries.length} 个会话`)
      return summaries
    } catch (error) {
      console.error('获取会话列表失败:', error)
      throw new Error(`获取会话列表失败: ${error instanceof Error ? error.message : '未知错误'}`)
    }
  }

  // ==================== IndexedDB 操作方法 ====================

  /**
   * 保存会话（覆盖式）
   */
  private async saveSessionToDB(): Promise<void> {
    if (!this.currentSessionId.value) return

    const sessionId = this.currentSessionId.value

    // 获取现有会话数据（保留 createdAt）
    const existing = await this.getSessionFromDB(sessionId)
    const now = new Date().toISOString()

    // 将 Vue 响应式对象转换为纯 JSON 对象，以便 IndexedDB 可以克隆
    const plainMessages = JSON.parse(JSON.stringify(this.messages.value)) as ChatMessage[]

    const sessionData: SessionData = {
      sessionId,
      messages: plainMessages,
      createdAt: existing?.createdAt || now,
      updatedAt: now,
    }

    await indexedDBService.transaction('sessions', 'readwrite', (store) => store.put(sessionData))
  }

  /**
   * 获取会话
   */
  private async getSessionFromDB(sessionId: string): Promise<SessionData | null> {
    const result = await indexedDBService.transaction('sessions', 'readonly', (store) =>
      store.get(sessionId),
    )
    return result || null
  }

  /**
   * 获取所有会话摘要
   */
  private async getAllSessionsFromDB(): Promise<SessionSummary[]> {
    const sessions = (await indexedDBService.transaction('sessions', 'readonly', (store) =>
      store.getAll(),
    )) as SessionData[]

    const summaries: SessionSummary[] = sessions.map((s) => ({
      session_id: s.sessionId,
      created_at: s.createdAt,
      updated_at: s.updatedAt,
      message_count: s.messages.length,
      preview_text: this.getPreviewText(s.messages),
    }))

    // 按更新时间倒序排列
    summaries.sort(
      (a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime(),
    )
    return summaries
  }

  /**
   * 获取消息预览文本（第一条用户消息）
   */
  private getPreviewText(messages: ChatMessage[]): string {
    if (messages.length === 0) return ''

    // 找到第一条用户消息
    const firstUserMessage = messages.find((msg) => isUserMessage(msg))
    if (!firstUserMessage) return ''

    return firstUserMessage.content
      .filter((c) => c.type === ChatMessageUserContentType.TEXT)
      .map((c) => c.content)
      .join('')
      .slice(0, 100)
  }

  /**
   * 删除会话（从本地存储）
   */
  private async deleteSessionFromDB(sessionId: string): Promise<void> {
    await indexedDBService.transaction('sessions', 'readwrite', (store) => store.delete(sessionId))
  }
}

// 创建全局实例
export const SESSION_MANAGER = new SessionManager()
