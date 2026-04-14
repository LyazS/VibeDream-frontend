import { ref } from 'vue'
import { fetchClient } from '@/utils/fetchClient'
import { generateAgentMessageId } from '@/core/utils/idGenerator'
import { API_ENDPOINTS } from '@/aipanel/agent/services/apiTypes'
import type {
  CreateSessionResponse,
  SessionSnapshotResponse,
} from '@/aipanel/agent/services/apiTypes'
import type {
  AgentMessage,
  AgentStreamEvent,
  FrontendToolInterrupt,
  MessageDeltaEvent,
  SessionSummary,
  StartRunRequest,
  ToolResultRequest,
} from '@/aipanel/agent/types'
import {
  AgentMessageRole,
  MessagePartType,
  getMessageTextParts,
  isUserMessage,
} from '@/aipanel/agent/types'
import { useEditSDK } from '@/aipanel/agent/composables/useEditSDK'
import { indexedDBService } from '@/core/storage/IndexedDBService'

export interface SessionInfo {
  sessionId: string
  createdAt: Date
  lastActivity: Date
}

interface SessionData {
  sessionId: string
  messages: AgentMessage[]
  completedMessageIds: string[]
  createdAt: string
  updatedAt: string
}

export class SessionManager {
  public currentSessionId = ref<string | null>(null)
  public messages = ref<AgentMessage[]>([])
  public completedMessageIds = ref<string[]>([])
  public isLoading = ref(false)
  public sessionError = ref<string | null>(null)
  public isSending = ref(false)

  private currentAbortController: AbortController | null = null
  private pendingUserMessage: AgentMessage | null = null
  private editSDK: ReturnType<typeof useEditSDK>

  constructor() {
    this.editSDK = useEditSDK()
  }

  clearCurrentSession(): void {
    if (this.currentAbortController) {
      this.currentAbortController.abort()
    }

    this.currentSessionId.value = null
    this.messages.value = []
    this.completedMessageIds.value = []
    this.isSending.value = false
    this.currentAbortController = null
    this.pendingUserMessage = null
    this.sessionError.value = null
  }

  async deleteSession(sessionId: string): Promise<void> {
    await this.deleteSessionFromDB(sessionId)
    if (this.currentSessionId.value === sessionId) {
      this.clearCurrentSession()
    }
  }

  isTaskCompleteMessage(messageId: string): boolean {
    return this.completedMessageIds.value.includes(messageId)
  }

  abortCurrentMessage(): void {
    if (this.currentAbortController) {
      this.currentAbortController.abort()
    }
    this.isSending.value = false
    this.currentAbortController = null
    this.pendingUserMessage = null
  }

  async handleSendMessage(message: string): Promise<void> {
    const sessionId = await this.ensureSession()
    this.isSending.value = true
    this.sessionError.value = null

    try {
      this.pendingUserMessage = this.createLocalUserMessage(message)

      const runRequest: StartRunRequest = {
        input: {
          parts: [
            {
              type: MessagePartType.TEXT,
              text: message,
            },
          ],
        },
      }

      await this.consumeStream(
        API_ENDPOINTS.startRun(sessionId),
        runRequest,
        sessionId,
      )

      await this.saveSessionToDB()
    } catch (error) {
      this.pendingUserMessage = null
      this.sessionError.value = error instanceof Error ? error.message : '发送消息失败'
      throw error instanceof Error ? error : new Error('发送消息失败')
    } finally {
      this.isSending.value = false
      this.currentAbortController = null
    }
  }

  async restoreSession(sessionId: string): Promise<void> {
    this.currentSessionId.value = sessionId

    const localSession = await this.getSessionFromDB(sessionId)
    if (localSession) {
      this.messages.value = localSession.messages
      this.completedMessageIds.value = localSession.completedMessageIds || []
    } else {
      this.messages.value = []
      this.completedMessageIds.value = []
    }

    const snapshot = await fetchClient.get<SessionSnapshotResponse>(
      API_ENDPOINTS.sessionSnapshot(sessionId),
    )
    this.applySnapshot(snapshot.data)
    await this.saveSessionToDB()
  }

  async getAllSessions(): Promise<SessionSummary[]> {
    const summaries = await this.getAllSessionsFromDB()
    summaries.sort(
      (a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime(),
    )
    return summaries
  }

  private async ensureSession(): Promise<string> {
    if (this.currentSessionId.value) {
      return this.currentSessionId.value
    }

    this.isLoading.value = true
    try {
      const response = await fetchClient.post<CreateSessionResponse>(API_ENDPOINTS.createSession)
      this.currentSessionId.value = response.data.session_id
      return response.data.session_id
    } finally {
      this.isLoading.value = false
    }
  }

  private createLocalUserMessage(text: string): AgentMessage {
    return {
      id: generateAgentMessageId('user'),
      role: AgentMessageRole.USER,
      parts: [
        {
          type: MessagePartType.TEXT,
          text,
        },
      ],
      created_at: new Date().toISOString(),
    }
  }

  private async consumeStream(
    url: string,
    payload: StartRunRequest | ToolResultRequest,
    sessionId: string,
  ): Promise<void> {
    this.currentAbortController = new AbortController()

    await fetchClient.stream<AgentStreamEvent>(
      'POST',
      url,
      async (event) => {
        await this.handleStreamEvent(event, sessionId)
      },
      payload,
      { signal: this.currentAbortController.signal },
    )
  }

  private async handleStreamEvent(event: AgentStreamEvent, sessionId: string): Promise<void> {
    this.commitPendingUserMessage()

    switch (event.type) {
      case 'run.started':
        break
      case 'message.delta':
        this.applyMessageDelta(event)
        break
      case 'message.completed':
        this.upsertMessage(event.message)
        break
      case 'run.paused':
        await this.handlePausedRun(sessionId, event.run_id, {
          type: 'frontend_tool',
          tool_call_id: event.tool_call_id,
          tool_name: event.tool_name,
          args: event.args,
        })
        break
      case 'run.completed':
        if (event.message_id) {
          this.markMessageCompleted(event.message_id)
        }
        break
      case 'run.failed':
        throw new Error(event.detail || event.error_code || 'Agent 运行失败')
    }
  }

  private commitPendingUserMessage(): void {
    if (!this.pendingUserMessage) return
    this.messages.value.push(this.pendingUserMessage)
    this.pendingUserMessage = null
  }

  private applyMessageDelta(event: MessageDeltaEvent): void {
    const existing = this.messages.value.find((message) => message.id === event.message_id)
    if (existing) {
      const textPart = existing.parts.find((part) => part.type === MessagePartType.TEXT)
      if (textPart && textPart.type === MessagePartType.TEXT) {
        textPart.text += event.delta
      } else {
        existing.parts.push({
          type: MessagePartType.TEXT,
          text: event.delta,
        })
      }
      return
    }

    this.messages.value.push({
      id: event.message_id,
      role: AgentMessageRole.ASSISTANT,
      parts: [
        {
          type: MessagePartType.TEXT,
          text: event.delta,
        },
      ],
      created_at: new Date().toISOString(),
    })
  }

  private upsertMessage(message: AgentMessage): void {
    const index = this.messages.value.findIndex((item) => item.id === message.id)
    if (index >= 0) {
      this.messages.value[index] = message
      return
    }
    this.messages.value.push(message)
  }

  private markMessageCompleted(messageId: string): void {
    if (!this.completedMessageIds.value.includes(messageId)) {
      this.completedMessageIds.value = [...this.completedMessageIds.value, messageId]
    }
  }

  private async handlePausedRun(
    sessionId: string,
    runId: string,
    tool: FrontendToolInterrupt,
  ): Promise<void> {
    if (!this.editSDK.hasTool(tool.tool_name)) {
      throw new Error(`前端工具不存在: ${tool.tool_name}`)
    }

    const result = await this.editSDK.executeTool(tool.tool_name, tool.args)
    const payload: ToolResultRequest = {
      tool_call_id: tool.tool_call_id,
      output: result.success ? result.result : `工具执行失败: ${result.error}`,
      is_error: !result.success,
    }

    await this.consumeStream(
      API_ENDPOINTS.submitToolResult(sessionId, runId),
      payload,
      sessionId,
    )
  }

  private applySnapshot(snapshot: SessionSnapshotResponse): void {
    this.currentSessionId.value = snapshot.session.session_id
    this.messages.value = snapshot.messages
  }

  private async saveSessionToDB(): Promise<void> {
    if (!this.currentSessionId.value) return

    const existing = await this.getSessionFromDB(this.currentSessionId.value)
    const now = new Date().toISOString()
    const plainMessages = JSON.parse(JSON.stringify(this.messages.value)) as AgentMessage[]

    const sessionData: SessionData = {
      sessionId: this.currentSessionId.value,
      messages: plainMessages,
      completedMessageIds: [...this.completedMessageIds.value],
      createdAt: existing?.createdAt || now,
      updatedAt: now,
    }

    await indexedDBService.transaction('sessions', 'readwrite', (store) => store.put(sessionData))
  }

  private async getSessionFromDB(sessionId: string): Promise<SessionData | null> {
    const result = await indexedDBService.transaction('sessions', 'readonly', (store) =>
      store.get(sessionId),
    )
    return result || null
  }

  private async getAllSessionsFromDB(): Promise<SessionSummary[]> {
    const sessions = (await indexedDBService.transaction('sessions', 'readonly', (store) =>
      store.getAll(),
    )) as SessionData[]

    return sessions.map((session) => ({
      session_id: session.sessionId,
      created_at: session.createdAt,
      updated_at: session.updatedAt,
      message_count: session.messages.length,
      preview_text: this.getPreviewText(session.messages),
    }))
  }

  private getPreviewText(messages: AgentMessage[]): string {
    const firstUserMessage = messages.find((message) => isUserMessage(message))
    if (!firstUserMessage) return ''

    return getMessageTextParts(firstUserMessage)
      .map((part) => part.text)
      .join('')
      .slice(0, 100)
  }

  private async deleteSessionFromDB(sessionId: string): Promise<void> {
    await indexedDBService.transaction('sessions', 'readwrite', (store) => store.delete(sessionId))
  }
}

export const SESSION_MANAGER = new SessionManager()
