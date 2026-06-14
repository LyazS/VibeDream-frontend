import { ref } from 'vue'
import { fetchClient } from '@/utils/fetchClient'
import { generateAgentMessageId } from '@/core/utils/idGenerator'
import { API_ENDPOINTS } from '@/aipanel/agent/services/apiTypes'
import { useUnifiedStore } from '@/core/unifiedStore'
import { exportTimelineJsonBundle } from '@/aipanel/timeline-json/exportTimelineJsonBundle'
import type {
  CreateSessionResponse,
  SessionSnapshotResponse,
} from '@/aipanel/agent/services/apiTypes'
import type {
  AgentMessage,
  AgentStreamEvent,
  FrontendToolInterrupt,
  InteractionResultRequest,
  InteractiveInterrupt,
  MessageDeltaEvent,
  PendingInterrupt,
  SessionInteractionRecord,
  SessionSummary,
  StartRunRequest,
  ToolResultRequest,
} from '@/aipanel/agent/types'
import {
  AgentMessageRole,
  MessagePartType,
  getMessageTextParts,
  isFrontendToolInterrupt,
  isInteractiveInterrupt,
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
  interactions: SessionInteractionRecord[]
  createdAt: string
  updatedAt: string
}

class AgentRunFailedError extends Error {
  constructor(
    message: string,
    public readonly runId: string,
    public readonly errorCode: string,
    public readonly retryable: boolean,
  ) {
    super(message)
    this.name = 'AgentRunFailedError'
  }
}

function isAgentRunFailedError(error: unknown): error is AgentRunFailedError {
  return error instanceof AgentRunFailedError
}

export class SessionManager {
  public currentSessionId = ref<string | null>(null)
  public messages = ref<AgentMessage[]>([])
  public completedMessageIds = ref<string[]>([])
  public isLoading = ref(false)
  public sessionError = ref<string | null>(null)
  public isSending = ref(false)
  public pendingInterrupt = ref<PendingInterrupt | null>(null)
  public pendingInteraction = ref<InteractiveInterrupt | null>(null)
  public pendingFrontendTool = ref<FrontendToolInterrupt | null>(null)
  public pendingRunId = ref<string | null>(null)
  public interactions = ref<SessionInteractionRecord[]>([])

  private currentAbortController: AbortController | null = null
  private pendingUserMessage: AgentMessage | null = null
  private editSDK: ReturnType<typeof useEditSDK>
  private unifiedStore: ReturnType<typeof useUnifiedStore>

  constructor() {
    this.editSDK = useEditSDK()
    this.unifiedStore = useUnifiedStore()
  }

  clearCurrentSession(): void {
    if (this.currentAbortController) {
      this.currentAbortController.abort()
    }

    this.currentSessionId.value = null
    this.messages.value = []
    this.completedMessageIds.value = []
    this.interactions.value = []
    this.isSending.value = false
    this.currentAbortController = null
    this.pendingUserMessage = null
    this.sessionError.value = null
    this.clearPendingInterrupt()
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
      if (this.hasPendingAskUserInterrupt()) {
        this.pendingUserMessage = null
        await this.resumePendingInteraction(sessionId, message, 'custom_input')
      } else {
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
          timeline: this.exportCurrentTimeline(),
        }

        await this.consumeStream(
          API_ENDPOINTS.startRun(sessionId),
          runRequest,
          sessionId,
        )
      }

      await this.saveSessionToDB()
    } catch (error) {
      this.pendingUserMessage = null
      if (isAgentRunFailedError(error) && !error.retryable) {
        this.clearPendingInterrupt()
      }
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
      this.interactions.value = localSession.interactions || []
    } else {
      this.messages.value = []
      this.completedMessageIds.value = []
      this.interactions.value = []
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

  private exportCurrentTimeline(): StartRunRequest['timeline'] {
    return exportTimelineJsonBundle({
      projectId: this.unifiedStore.projectId,
      tracks: this.unifiedStore.tracks,
      timelineItems: this.unifiedStore.timelineItems,
    })
  }

  private async consumeStream(
    url: string,
    payload: StartRunRequest | ToolResultRequest | InteractionResultRequest,
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
        await this.handlePausedRun(sessionId, event.run_id, event.interrupt)
        break
      case 'run.completed':
        if (event.message_id) {
          this.markMessageCompleted(event.message_id)
        }
        this.clearPendingInterrupt()
        break
      case 'run.failed':
        this.clearPendingInterrupt()
        throw new AgentRunFailedError(
          event.detail || event.error_code || 'Agent 运行失败',
          event.run_id,
          event.error_code,
          event.retryable,
        )
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
    interrupt: PendingInterrupt,
  ): Promise<void> {
    if (isInteractiveInterrupt(interrupt)) {
      this.upsertInteractionRecord({
        interrupt,
        result: this.getInteractionRecord(interrupt.interaction_id)?.result || null,
      })
      this.setPendingInterrupt(runId, interrupt)
      return
    }

    if (interrupt.tool_name === 'edit_sdk') {
      throw new Error('edit_sdk 已停用，请使用后端 timeline_* 工具')
    }

    if (!this.editSDK.hasTool(interrupt.tool_name)) {
      throw new Error(`前端工具不存在: ${interrupt.tool_name}`)
    }

    const previousInterrupt = interrupt
    const previousRunId = runId
    this.setPendingInterrupt(runId, interrupt)

    try {
      const result = await this.editSDK.executeTool(interrupt.tool_name, interrupt.args, {
        toolCallId: interrupt.tool_call_id,
      })
      const payload: ToolResultRequest = {
        tool_call_id: interrupt.tool_call_id,
        output: result.success ? result.result : `工具执行失败: ${result.error}`,
        is_error: !result.success,
      }

      this.clearPendingInterrupt()
      await this.consumeStream(
        API_ENDPOINTS.submitToolResult(sessionId, runId),
        payload,
        sessionId,
      )
    } catch (error) {
      if (isAgentRunFailedError(error) && !error.retryable) {
        this.clearPendingInterrupt()
      } else {
        this.setPendingInterrupt(previousRunId, previousInterrupt)
      }
      throw error
    }
  }

  private applySnapshot(snapshot: SessionSnapshotResponse): void {
    this.currentSessionId.value = snapshot.session.session_id
    this.messages.value = snapshot.messages
    this.interactions.value = snapshot.interactions || []
    if (snapshot.pending_run?.interrupt) {
      this.setPendingInterrupt(snapshot.pending_run.run_id, snapshot.pending_run.interrupt)
      return
    }
    this.clearPendingInterrupt()
  }

  private async resumePendingInteraction(
    sessionId: string,
    message: string,
    submittedVia: 'option' | 'custom_input',
  ): Promise<void> {
    const interrupt = this.pendingInteraction.value
    const runId = this.pendingRunId.value
    if (!interrupt || !runId) {
      throw new Error('当前没有待回答的交互问题')
    }

    const previousInterrupt = interrupt
    const previousRunId = runId
    const previousInteractions = [...this.interactions.value]
    this.clearPendingInterrupt()
    this.upsertInteractionResult(interrupt.interaction_id, message.trim(), submittedVia)

    const payload: InteractionResultRequest = {
      interaction_id: interrupt.interaction_id,
      answer: message,
      submitted_via: submittedVia,
    }

    try {
      await this.consumeStream(
        API_ENDPOINTS.submitInteractionResult(sessionId, runId),
        payload,
        sessionId,
      )
    } catch (error) {
      if (isAgentRunFailedError(error) && !error.retryable) {
        this.clearPendingInterrupt()
      } else {
        this.interactions.value = previousInteractions
        this.setPendingInterrupt(previousRunId, previousInterrupt)
      }
      throw error
    }
  }

  private hasPendingAskUserInterrupt(): boolean {
    return !!this.pendingInteraction.value && !!this.pendingRunId.value
  }

  private setPendingInterrupt(runId: string, interrupt: PendingInterrupt): void {
    this.pendingRunId.value = runId
    this.pendingInterrupt.value = interrupt
    this.pendingInteraction.value = isInteractiveInterrupt(interrupt) ? interrupt : null
    this.pendingFrontendTool.value = isFrontendToolInterrupt(interrupt) ? interrupt : null
  }

  private clearPendingInterrupt(): void {
    this.pendingRunId.value = null
    this.pendingInterrupt.value = null
    this.pendingInteraction.value = null
    this.pendingFrontendTool.value = null
  }

  public async submitPendingAskUserOption(option: string): Promise<void> {
    const answer = option.trim()
    if (!answer) return
    const sessionId = await this.ensureSession()
    this.isSending.value = true
    this.sessionError.value = null

    try {
      await this.resumePendingInteraction(sessionId, answer, 'option')
      await this.saveSessionToDB()
    } catch (error) {
      this.sessionError.value = error instanceof Error ? error.message : '发送消息失败'
      throw error instanceof Error ? error : new Error('发送消息失败')
    } finally {
      this.isSending.value = false
      this.currentAbortController = null
    }
  }

  public async submitPendingAskUserResponse(response: string): Promise<void> {
    const answer = response.trim()
    if (!answer) return
    const sessionId = await this.ensureSession()
    this.isSending.value = true
    this.sessionError.value = null

    try {
      await this.resumePendingInteraction(sessionId, answer, 'custom_input')
      await this.saveSessionToDB()
    } catch (error) {
      this.sessionError.value = error instanceof Error ? error.message : '发送消息失败'
      throw error instanceof Error ? error : new Error('发送消息失败')
    } finally {
      this.isSending.value = false
      this.currentAbortController = null
    }
  }

  public getInteractionRecord(interactionId: string): SessionInteractionRecord | null {
    return (
      this.interactions.value.find((record) => record.interrupt.interaction_id === interactionId) || null
    )
  }

  private upsertInteractionRecord(record: SessionInteractionRecord): void {
    const index = this.interactions.value.findIndex(
      (item) => item.interrupt.interaction_id === record.interrupt.interaction_id,
    )
    if (index >= 0) {
      this.interactions.value[index] = record
      return
    }
    this.interactions.value = [...this.interactions.value, record]
  }

  private upsertInteractionResult(
    interactionId: string,
    answer: string,
    submittedVia: 'option' | 'custom_input',
  ): void {
    const submittedAt = new Date().toISOString()
    this.interactions.value = this.interactions.value.map((record) =>
      record.interrupt.interaction_id === interactionId
        ? {
            ...record,
            result: {
              interaction_id: interactionId,
              kind: record.interrupt.kind,
              answer,
              submitted_via: submittedVia,
              submitted_at: submittedAt,
            },
          }
        : record,
    )
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
      interactions: JSON.parse(JSON.stringify(this.interactions.value)) as SessionInteractionRecord[],
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
