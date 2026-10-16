import { computed, onScopeDispose, readonly, ref, shallowRef, watch } from 'vue'
import { API_BASE_URL } from '@/config/runtimeConfig'
import { enabledApiCapabilities } from '@/config/apiCapabilities'
import { buildTextMessages } from '@/core/agent/prompts/textMessages'
import { captureBackgroundContext } from '@/core/agent/prompts/backgroundContext'
import { agentTools, createToolRuntime } from '@/core/agent/runtime/ToolRuntime'
import { AgentSessionStore } from '@/core/agent/runtime/AgentSessionStore'
import {
  AGENT_IMAGE_LIMITS,
  AgentImageProcessingError,
  type AgentImageErrorCode,
  processAgentImage,
  prepareAgentImages,
  invalidateAgentImageUploads,
  rememberAgentImages,
  forgetAgentImages,
  retainAgentAttachment,
  readAgentImageSource,
  deleteAgentImageSource,
  AgentImageSourceError,
  type ResolvedAgentImage,
} from '@/core/agent/services/agentImageService'
import { getAgentContextUsage, summarizeAgentUsage } from '@/core/agent/runtime/AgentUsage'
import { AgentTelemetry, newLogSource } from '@/core/agent/runtime/AgentTelemetry'
import { toolLogMetadata, type LogSource, type StopStatus } from '@/core/agent/telemetry/agent-log'
import type { ToolResult } from '@/core/agent/tools/types'
import {
  AgentClient,
  type ConnectionState,
  type StreamParams,
  type ModelMessage,
  type ImageContentPart,
  type TextContentPart,
} from '@/core/agent/transport/AgentClient'
import {
  AgentMessageRole,
  MessagePartType,
  getMessageTextParts,
  type AgentMessage,
  ToolCallStatus,
  type ToolCallPart,
  type InteractionSubmittedVia,
  type AgentSession,
  type ModelCallSummary,
  type ToolExecution,
  type AgentImage,
} from '@/core/agent/types'
import { MODULE_NAMES, type ModuleMap, type ModuleRegistry } from './ModuleRegistry'

type AgentRun = {
  session: AgentSession
  trigger: AgentMessage
  model: AbortController
  tool: AbortController
  lifecycle: AbortSignal
  stopped: boolean
  finalized: boolean
  modelCall: ModelCallSummary | null
  awaitingCompletion: boolean
  committed: boolean
}

export type AgentDraftImage = {
  id: string
  status: 'queued' | 'processing' | 'ready' | 'failed'
  image?: AgentImage
  error?: AgentImageErrorCode
}

export type AgentDraft = {
  text: string
  images: AgentDraftImage[]
  imageError: 'imageCountLimit' | null
  submitting: boolean
  submitError: string | null
}

type DraftImageTask = {
  release: () => void
  controller: AbortController
  userId: string
  projectId: string
} & ({ input: Blob; image?: never } | { input?: never; image: AgentImage })

type LocalSubmission = {
  session: AgentSession
  images: readonly AgentImage[]
  committed: boolean
  settled: Promise<void>
  settle: () => void
  commit: () => void
  rollback: (error: unknown) => void
}

/** 创建工程级 Agent 模块，管理本地会话、模型调用及生命周期，并导出只读状态和操作。 */
export function createUnifiedAgentModule(registry: ModuleRegistry) {
  // 当前账户来源，用于发送准入、身份变化监听和异步结果归属检查。
  const user = registry.get<ModuleMap['user']>(MODULE_NAMES.USER)
  // 工程 ID 和名称来源，每次发送时读取并保存到请求快照。
  const config = registry.get<ModuleMap['config']>(MODULE_NAMES.CONFIG)
  // 工程加载状态来源，设置和时间轴均就绪后才允许发送。
  const project = registry.get<ModuleMap['project']>(MODULE_NAMES.PROJECT)
  // 服务端明确通知身份失效后阻止发送，账户 ID 变化时重置。
  const identityInvalid = ref(false)
  // Agent 发布开关与其他 API 能力共用构建配置。
  const enabled = enabledApiCapabilities.has('agent')
  // 模块是否已最终释放；释放后即使工程和账户有效，也不能再发送。
  const disposed = ref(false)
  // 会话存储和当前账户/工程的内存索引。
  const sessionStore = new AgentSessionStore()
  const pendingImages = new Map<string, AgentImage[]>()
  const emptyDraft = (): AgentDraft => ({
    text: '',
    images: [],
    imageError: null,
    submitting: false,
    submitError: null,
  })
  const draft = shallowRef<AgentDraft>(emptyDraft())
  const draftImageTasks = new Map<string, DraftImageTask>()
  let draftImageWorker: object | null = null
  const localSubmission = shallowRef<LocalSubmission | null>(null)
  // 日志独立于聊天存储；读取实时账号，供后台补传在切号时立即停止。
  const telemetry = new AgentTelemetry(() => user.currentUser.value?.id)
  // 仅缓存当前账户工程分区；账户变化清空，IndexedDB 中其他分区仍保留。
  const sessions = ref<Record<string, AgentSession>>({})
  // 历史读取完成前阻止发送，避免新输入覆盖尚未加载的会话。
  const historyLoading = ref(true)
  // 保存或读取失败的界面错误；当前阶段阻止继续发送，不自动重试。
  const storageError = ref<string | null>(null)
  // 综合环境、模块生命周期、账户和工程就绪状态的发送准入条件。
  const ready = computed(
    /** 检查当前环境、账户和工程是否满足发送条件。 */ () =>
      Boolean(
        enabled &&
          !disposed.value &&
          !identityInvalid.value &&
          !historyLoading.value &&
          !storageError.value &&
          user.currentUser.value?.id &&
          config.projectId.value &&
          project.isProjectSettingsReady.value &&
          project.isProjectTimelineReady.value,
      ),
  )
  // 当前展示会话的标识；选择或新建只改变展示，不影响另一个正在运行的会话。
  const currentSessionId = ref<string>(crypto.randomUUID())
  // 当前展示数据的入口；loop 必须使用启动时捕获的 session，不从此处取得异步写入目标。
  const currentSession = computed(() => sessions.value[currentSessionId.value])
  // 唯一对话记录：立即保存用户输入和助手增量，工具调用与结果成对写入；中断保留实际收到的文本。
  const currentMessages = computed(() => currentSession.value?.messages ?? [])
  // 最近一次调用只保存状态及消息关联；完整输入输出交给诊断日志。
  const latestModelCall = computed(() => currentSession.value?.latestModelCall ?? null)
  const usage = computed(() => summarizeAgentUsage(currentSession.value?.usageRecords ?? {}))
  const contextUsage = computed(() =>
    getAgentContextUsage(
      currentSession.value?.usageRecords ?? {},
      currentSession.value?.latestModelCall?.id,
    ),
  )
  // 工程运行槽所属会话，空闲/等待问题时为 null，与当前展示 ID 相互独立。
  const activeRun = shallowRef<AgentRun | null>(null)
  const activeSessionId = computed(() => activeRun.value?.session.id ?? null)
  // 工程是否占用运行槽直接从归属 ID 推导，避免维护另一份开关状态。
  const running = computed(() => activeSessionId.value !== null)
  // 当前展示会话是否运行，用于它自己的停止按钮和思考提示；其他会话只受 busy 限制。
  const currentRunning = computed(
    () => running.value && activeSessionId.value === currentSessionId.value,
  )
  // 按助手消息 ID 保存未完成工具；执行中及待回答时保留，调用和结果成对写入消息后移除。
  const toolExecutions = computed(() => currentSession.value?.toolExecutions ?? {})
  // 从最后一条助手消息推导未回答问题；ask_user 等待期间不占运行槽，停止也保留问题。
  const pendingInteraction = computed(() => {
    const message = currentMessages.value[currentMessages.value.length - 1]
    return message?.role === AgentMessageRole.ASSISTANT &&
      message.interaction?.interrupt.kind === 'ask_user' &&
      !message.interaction.result
      ? message.interaction.interrupt
      : null
  })
  const draftEditable = computed(
    () => ready.value && !draft.value.submitting && (!running.value || currentRunning.value),
  )
  const draftSendable = computed(
    () =>
      ready.value &&
      !running.value &&
      !localSubmission.value &&
      !pendingInteraction.value &&
      !draft.value.submitting &&
      draft.value.images.every((item) => item.status === 'ready') &&
      Boolean(draft.value.text.trim() || draft.value.images.length),
  )

  function setDraftText(text: string) {
    if (!draftEditable.value) return
    draft.value = { ...draft.value, text, submitError: null }
  }

  function updateDraftImage(id: string, changes: Partial<AgentDraftImage>) {
    draft.value = {
      ...draft.value,
      images: draft.value.images.map((item) => (item.id === id ? { ...item, ...changes } : item)),
    }
  }

  function ownsDraftImage(id: string, task: DraftImageTask) {
    return (
      !disposed.value &&
      !task.controller.signal.aborted &&
      draftImageTasks.get(id) === task &&
      task.userId === user.currentUser.value?.id &&
      task.projectId === config.projectId.value
    )
  }

  async function processDraftImages() {
    if (draftImageWorker) return
    const worker = {}
    draftImageWorker = worker
    try {
      while (draftImageWorker === worker) {
        const item = draft.value.images.find((image) => image.status === 'queued')
        if (!item) return
        const task = draftImageTasks.get(item.id)
        if (!task?.input || !ownsDraftImage(item.id, task)) return
        updateDraftImage(item.id, { status: 'processing', error: undefined })
        try {
          const image = await processAgentImage(task.input, task.controller.signal, {
            userId: task.userId,
            projectId: task.projectId,
            id: item.id,
          })
          if (!ownsDraftImage(item.id, task)) {
            void deleteAgentImageSource(image).catch(() => {})
            continue
          }
          draftImageTasks.set(item.id, {
            image,
            controller: task.controller,
            release: task.release,
            userId: task.userId,
            projectId: task.projectId,
          })
          updateDraftImage(item.id, { status: 'ready', image })
        } catch (error) {
          if (!ownsDraftImage(item.id, task)) continue
          updateDraftImage(item.id, {
            status: 'failed',
            error:
              error instanceof AgentImageProcessingError ? error.code : 'imageProcessingFailed',
          })
        }
      }
    } finally {
      if (draftImageWorker === worker) draftImageWorker = null
    }
  }

  function addDraftImages(files: readonly Blob[]) {
    const userId = user.currentUser.value?.id
    if (!draftEditable.value || !userId) return
    const available = Math.max(0, AGENT_IMAGE_LIMITS.count - draft.value.images.length)
    const images = files.slice(0, available).map((input): AgentDraftImage => {
      const id = crypto.randomUUID()
      draftImageTasks.set(id, {
        input,
        controller: new AbortController(),
        userId,
        projectId: config.projectId.value,
        release: retainAgentAttachment(config.projectId.value, id),
      })
      return { id, status: 'queued' }
    })
    draft.value = {
      ...draft.value,
      images: [...draft.value.images, ...images],
      imageError: files.length > available ? 'imageCountLimit' : null,
      submitError: null,
    }
    void processDraftImages()
  }

  function removeDraftImage(id: string) {
    if (draft.value.submitting) return
    const task = draftImageTasks.get(id)
    task?.controller.abort()
    task?.release()
    if (task?.image) void deleteAgentImageSource(task.image).catch(() => {})
    draftImageTasks.delete(id)
    draft.value = {
      ...draft.value,
      images: draft.value.images.filter((item) => item.id !== id),
      imageError: null,
      submitError: null,
    }
  }

  function retryDraftImage(id: string) {
    if (!draftEditable.value || !draftImageTasks.has(id)) return
    if (draft.value.images.find((item) => item.id === id)?.status !== 'failed') return
    updateDraftImage(id, { status: 'queued', error: undefined })
    void processDraftImages()
  }

  function resetDraft(committed = false, submission?: LocalSubmission) {
    draftImageTasks.forEach((task) => {
      task.controller.abort()
      const image = task.image
      if (
        !committed &&
        image &&
        submission?.images.some((submitted) => submitted.id === image.id)
      ) {
        // Account/project cleanup must wait until the atomic local commit decides file ownership.
        void submission.settled.then(async () => {
          if (!submission.committed) await deleteAgentImageSource(image).catch(() => {})
          task.release()
        })
      } else {
        task.release()
        if (!committed && image) void deleteAgentImageSource(image).catch(() => {})
      }
    })
    draftImageTasks.clear()
    draftImageWorker = null
    draft.value = emptyDraft()
  }

  function clearDraft() {
    if (!draft.value.submitting) resetDraft()
  }
  // 工具运行时调用编辑器执行器及撤销命令。
  const toolRuntime = createToolRuntime()
  // 客户端连接状态的响应式镜像，供顶栏展示连接颜色及读取关闭原因。
  const connection = ref<ConnectionState>({
    status: 'disconnected',
    closeReason: null,
    error: null,
  })
  // 模型和工具分别取消；停止会取消素材读取/检索，生命周期清理取消所有工具。
  let lifecycle = new AbortController()

  // 从当前账户工程分区的会话生成按最近更新排序的历史摘要。
  const sessionHistory = computed(() =>
    Object.values(sessions.value)
      .filter((session) => session.messages.length)
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
      .map((session) => ({
        id: session.id,
        updatedAt: session.updatedAt,
        preview:
          session.messages
            .filter((message) => message.role === AgentMessageRole.USER)
            .map((message) =>
              getMessageTextParts(message)
                .map((part) => part.text)
                .join(''),
            )[0] ?? '',
        running: running.value && activeSessionId.value === session.id,
        waiting: Boolean(
          session.messages[session.messages.length - 1]?.interaction &&
            !session.messages[session.messages.length - 1]?.interaction?.result,
        ),
      })),
  )

  function reportStorageError(session: AgentSession, error: unknown) {
    if (sessions.value[session.id] === session) {
      storageError.value = error instanceof Error ? error.message : String(error)
    }
  }

  /** 保存固定会话快照；存储异常阻止新请求，详细恢复策略留待阶段 3.4。 */
  async function persistSession(session: AgentSession, submission?: LocalSubmission) {
    const pending = localSubmission.value
    if (pending?.session === session && pending !== submission) {
      await pending.settled
      if (sessions.value[session.id] !== session) return
    }
    session.updatedAt = new Date().toISOString()
    try {
      const images = pendingImages.get(session.id) ?? []
      await sessionStore.save(session, images)
      if (sessions.value[session.id] === session) rememberAgentImages(sessionStore, session, images)
      if (pendingImages.get(session.id) === images) pendingImages.delete(session.id)
    } catch (error) {
      if (!submission) reportStorageError(session, error)
      throw error
    }
  }

  // 模块唯一持有的工程级客户端，跨轮次和面板显隐复用，模块释放时销毁。
  const client = new AgentClient({
    onSettlement: (modelCallId, record) => {
      const session = Object.values(sessions.value).find((session) =>
        Object.prototype.hasOwnProperty.call(session.usageRecords ?? {}, modelCallId),
      )
      if (
        !session ||
        session.userId !== user.currentUser.value?.id ||
        session.projectId !== config.projectId.value
      )
        return
      session.usageRecords[modelCallId] = record
      void persistSession(session).catch(() => {})
    },
    /** 连接前检查发送条件，并按当前工程生成 WebSocket 地址。 */
    url: () => {
      if (!ready.value) throw new Error('PROJECT_NOT_READY')
      const url = new URL('/api/agent/ws', API_BASE_URL || globalThis.location.origin)
      url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:'
      url.searchParams.set('project_id', config.projectId.value)
      return url.toString()
    },
  })
  // 连接状态订阅的取消函数，模块释放时解除客户端到响应式状态的同步。
  const unsubscribeConnection = client.subscribeConnection(
    /** 同步客户端连接状态，让 UI 跟随连接、断开和错误变化。 */ (state) => {
      connection.value = state
    },
  )

  /** 将实际对话内容组装为带角色、时间和固定 ID 的消息，不包含运行或提交状态。 */
  function buildDisplayMessage(id: string, role: AgentMessage['role'], text: string): AgentMessage {
    return {
      id,
      role,
      parts: [{ type: MessagePartType.TEXT, text }],
      created_at: new Date().toISOString(),
    }
  }
  /** 取得本轮唯一助手消息，首个增量或完整终态到达时才创建，后续始终更新同一个 ID。 */
  function getAssistantMessage(session: AgentSession, modelCall: ModelCallSummary): AgentMessage {
    let message = session.messages.find((message) => message.id === modelCall.assistantMessageId)
    if (!message) {
      session.messages.push(
        buildDisplayMessage(modelCall.assistantMessageId, AgentMessageRole.ASSISTANT, ''),
      )
      message = session.messages[session.messages.length - 1]!
    }
    return message
  }

  // UI 隐藏工具结果，仅从执行记录投影普通工具的待执行部件，实际消息历史始终没有未配对调用。
  const displayMessages = computed(
    /** 把普通工具的运行状态投影给 UI，不向 currentMessages 写入临时工具调用。 */ () => {
      return currentMessages.value
        .filter((message) => message.role !== 'tool')
        .map((message) => {
          const record = toolExecutions.value[message.id]
          const execution =
            record?.status === 'pending' && record.call.name !== 'ask_user' ? record : undefined
          // ask_user 已由问题卡片展示，回答后补入历史的同一调用不再展示普通工具条。
          // 只过滤 UI 投影；实际历史仍保留调用及结果，未生成问题卡片的参数错误调用仍显示错误。
          const parts = message.interaction
            ? message.parts.filter(
                (part) =>
                  part.type !== MessagePartType.TOOL_CALL ||
                  part.tool_name !== 'ask_user' ||
                  part.tool_call_id !== message.interaction?.interrupt.interaction_id,
              )
            : message.parts
          return {
            ...message,
            parts: execution
              ? [
                  ...parts,
                  {
                    type: MessagePartType.TOOL_CALL,
                    tool_call_id: execution.call.id,
                    tool_name: execution.call.name,
                    args: execution.call.args,
                    status: ToolCallStatus.REQUESTED,
                  } satisfies ToolCallPart,
                ]
              : parts,
          }
        })
    },
  )

  /** 立即撤销推进权限；首次提交结束后交接，其余阶段同步收口。 */
  function stop() {
    const run = activeRun.value
    if (!run || run.session.id !== currentSessionId.value || run.finalized) return
    run.stopped = true
    run.model.abort()
    const cancellable = Object.values(run.session.toolExecutions).some(
      (execution) =>
        execution.status === 'pending' &&
        (execution.call.name === 'read_media' || execution.call.name === 'search_media'),
    )
    if (cancellable) run.tool.abort()
    if (run.committed) finalizeRun(run, 'cancelled')
  }

  /** 新建空白会话并切换展示；已有会话及运行继续保留，共享客户端不变。 */
  function newChat() {
    const id = crypto.randomUUID()
    const now = new Date().toISOString()
    sessions.value[id] = {
      id,
      userId: user.currentUser.value?.id ?? '',
      projectId: config.projectId.value,
      createdAt: now,
      updatedAt: now,
      messages: [],
      latestModelCall: null,
      usageRecords: {},
      toolExecutions: {},
    }
    currentSessionId.value = id
  }

  /** 只选择当前账户工程已加载的会话，不停止运行，也不操作 WebSocket。 */
  function selectSession(id: string) {
    if (!sessions.value[id]) return false
    currentSessionId.value = id
    return true
  }

  /** 取消所有旧运行并隔离内存；已经落盘的历史不随页面/账户清理删除。 */
  function clearMemory() {
    activeRun.value?.model.abort()
    lifecycle.abort()
    lifecycle = new AbortController()
    activeRun.value = null
    sessions.value = {}
    pendingImages.clear()
    forgetAgentImages(sessionStore)
    const submission = localSubmission.value
    localSubmission.value = null
    resetDraft(false, submission ?? undefined)
    newChat()
  }

  /** 删除未占活动位的会话；旧保存按队列先完成，迟到回调失去会话归属。 */
  async function deleteSession(id: string) {
    const session = sessions.value[id]
    // 模块入口也检查运行归属，避免绕过界面禁用或点击时状态变化导致删除在途会话。
    if (!session || activeSessionId.value === id || localSubmission.value?.session.id === id)
      return false
    delete sessions.value[id]
    pendingImages.delete(id)
    forgetAgentImages(sessionStore, session)
    if (currentSessionId.value === id) newChat()
    const [attachments] = await Promise.all([
      sessionStore.delete(session),
      telemetry.delete(session),
    ])
    await Promise.all(attachments.map((image) => deleteAgentImageSource(image)))
    return true
  }

  /** 离开工程时隔离运行和内存，保留已保存历史，并关闭工程连接。 */
  function leaveProject() {
    clearMemory()
    client.close('PAGE_LEFT')
  }

  /**
   * 从实际对话生成历史，包含中断前的用户输入、部分助手回复和工具错误结果。
   * 文本部件逐段映射到 content；工具调用只在结果返回后成对提交，空白普通消息不发送。
   * UI 的进度投影和 interaction 不属于模型消息，只有回答后提交的 ask_user 配对进入工具历史。
   */
  function buildModelHistory(
    session: AgentSession,
    images: Map<string, ResolvedAgentImage>,
  ): ModelMessage[] {
    // 每次请求都从运行所属会话重新生成协议消息，保持对话顺序；与 UI 展示选择无关，不缓存第二份历史。
    // 系统提示词由 buildTextMessages() 添加；背景上下文属于对应用户消息的固定快照。
    const history: ModelMessage[] = []
    for (const message of session.messages) {
      // 用户图片按原顺序放在文字之前，兼容此前按文字优先保存的消息；背景快照放在最后。
      // 其他角色只映射文本；工具调用另行映射，进度和交互元数据不转成正文。
      const parts =
        message.role === AgentMessageRole.USER
          ? [
              ...message.parts.filter((part) => part.type === MessagePartType.IMAGE),
              ...message.parts.filter((part) => part.type !== MessagePartType.IMAGE),
            ]
          : message.parts
      const content: (TextContentPart | ImageContentPart)[] = parts.flatMap(
        (part): (TextContentPart | ImageContentPart)[] => {
          if (part.type === MessagePartType.TEXT) return [{ type: 'text', text: part.text }]
          if (part.type === MessagePartType.IMAGE && message.role === AgentMessageRole.USER) {
            if (!part.attachmentId) return []
            const image: ResolvedAgentImage = images.get(part.attachmentId) ?? {
              kind: 'unavailable',
              reason: 'record_missing',
            }
            const identity = `attachmentId=${encodeURIComponent(part.attachmentId)}, name=${encodeURIComponent(image.fileName ?? 'unknown')}`
            if (image.kind === 'unavailable')
              return [
                {
                  type: 'text',
                  text: `[ATTACHMENT ${identity}, original=missing, reason=${image.reason}]`,
                },
              ]
            return [
              { type: 'image_url', image_url: { url: image.url } },
              { type: 'text', text: `[ATTACHMENT ${identity}, original=${image.source}]` },
            ]
          }
          return []
        },
      )
      if (message.role === AgentMessageRole.USER) {
        const background = message.parts
          .filter((part) => part.type === MessagePartType.BACKGROUND_CONTEXT)
          .filter((part) => part.text.trim())
        content.push(
          ...background.map((part) => ({
            type: 'text' as const,
            text: `[BACKGROUND_CONTEXT]\n用户发送时的工程上下文快照：\n${part.text}`,
          })),
        )
      }
      const textContent = content.filter((part): part is TextContentPart => part.type === 'text')

      // 1. 工具结果作为独立的 tool 消息返回模型，成功、失败及参数校验错误都走此分支。
      // 文本部件内保存原工具输出或错误正文，不解析为 JSON，也不额外编码工具输出。
      // ask_user 的回答已经由 answerQuestion 写成 [ASK_RESULT]，在这里与其他工具结果同样处理。
      if (message.role === 'tool') {
        history.push({
          role: 'tool',
          content: textContent,
          // tool_call_id 对应前一条助手消息的调用 ID，name 对应工具名。
          // 非空断言依赖 commitToolResult() 创建结果时填写这两个字段，本函数不再次校验配对。
          tool_call_id: message.toolCallId!,
          name: message.toolName!,
        })
        // 工具结果即使正文为空也保留，避免丢失配对；之后不再按普通用户/助手消息处理。
        continue
      }

      // 2. 助手消息带有工具部件时，转换为 assistant + tool_calls，而不是普通文本消息。
      // find 只取一个调用，依赖当前“一轮最多一个工具”的协议约束；这里没有多工具合并逻辑。
      // 未返回结果的普通调用仅保存在 toolExecutions，由 displayMessages 投影给 UI，尚不在此列表。
      // 未回答的 ask_user 只有 interaction，回答后才由 commitToolResult() 补入工具部件和配对结果。
      const call = message.parts.find((part) => part.type === MessagePartType.TOOL_CALL)
      if (call?.type === MessagePartType.TOOL_CALL) {
        history.push({
          role: 'assistant',
          // 助手可以只有工具调用而没有正文，因此本分支不按空白文本过滤。
          content: textContent,
          tool_calls: [
            {
              id: call.tool_call_id,
              name: call.tool_name,
              // 参数来自 JSON 工具协议；序列化复制为普通对象，去掉 Vue 响应式代理供请求快照使用。
              // 这里只传原参数，不纠正参数类型；工具部件的 UI status 也不会发给模型。
              args: JSON.parse(JSON.stringify(call.args)) as Record<string, unknown>,
            },
          ],
        })
      } else if (content.some((part) => part.type === 'image_url' || part.text.trim())) {
        // 3. 普通用户/助手正文只要不是全空白就进入历史，不根据 modelCall 成功或中断状态过滤。
        // 所以失败前的用户输入、已经收到的部分助手回复都会进入用户下一次提交的请求。
        // 任意一段不是全空白就保留整条消息及全部文本部件；trim() 不修改实际发送的文本。
        history.push(
          message.role === AgentMessageRole.USER
            ? { role: 'user', content }
            : { role: message.role, content: textContent },
        )
      }
      // 三个分支都只挑选模型协议字段，消息 ID、时间和 interaction 等界面元数据不会发送。
    }
    return history
  }

  /**
   * 通过助手消息 ID 找到原正文，单次替换消息数组，成对补入工具调用及实际结果。
   * 用 success 区分成功/失败，错误结果也进入模型历史；同一记录只提交一次，提交后移除执行记录。
   * 保留原 output，只有失败且没有 output 时才使用 error 正文，避免下一轮收不到失败原因。
   */
  function commitToolResult(session: AgentSession, execution: ToolExecution, result: ToolResult) {
    // 同一执行记录已有结果就不再提交，避免重复追加工具调用和结果消息；失败结果也算已提交。
    if (execution.result) return
    // 通过执行记录保存的助手消息 ID 定位原消息，不依赖 latestModelCall，避免写到其他轮次的回复中。
    // 原助手消息不存在时无法构成调用与结果的配对，直接抛错，不修改执行记录和消息列表。
    const assistantIndex = session.messages.findIndex(
      (message) => message.id === execution.assistantMessageId,
    )
    if (assistantIndex === -1) throw new Error('TOOL_ASSISTANT_MESSAGE_NOT_FOUND')
    const assistant = session.messages[assistantIndex]!
    // 标记本次记录已提交，避免持有该记录的回调重复写入；完成状态由下方的消息部件保存供 UI 展示。
    execution.result = result
    execution.status = result.success ? 'completed' : 'failed'
    // 成功时原样保留 output，包括空字符串；失败时优先保留 output，其次使用 error 和兜底错误码。
    // 错误正文也作为工具结果交给模型，让下一轮能够根据失败原因修正参数或处理执行失败。
    const content = result.success
      ? result.output
      : result.output || result.error || 'TOOL_EXECUTION_FAILED'
    const source = newLogSource(execution.status, {
      name: execution.call.name,
      args: execution.call.args,
    })
    source.started_at = execution.startedAt ?? source.started_at
    source.ended_at = new Date().toISOString()
    source.duration_ms = Date.parse(source.ended_at) - Date.parse(source.started_at)
    source.output = {
      content,
      result,
      ...(assistant.interaction?.result ? { interaction: assistant.interaction.result } : {}),
    }
    source.error = result.success ? null : (result.error ?? content)
    // 工具结果固定使用同一节点 ID；重复提交或恢复执行只更新该节点版本。
    execution.resultSpanId ??= crypto.randomUUID()
    void telemetry.record(
      session,
      execution.resultSpanId,
      'tool_result',
      source,
      execution.modelCallId,
      execution.call.id,
    )
    // 新建独立的 tool 角色消息；其消息 ID 与调用 ID 不同，调用 ID 用于关联原助手的工具调用。
    // ask_user 的回答也走这里，content 已由回答入口构造成 [ASK_RESULT] 正文。
    const message = buildDisplayMessage(crypto.randomUUID(), 'tool', content)
    message.toolCallId = execution.call.id
    message.toolName = execution.call.name
    // 按原助手消息的位置插入结果，再一次替换实际消息列表，避免先写入未配对调用。
    // 即使原助手后面已有其他消息，也保证结果紧跟调用所属消息，并保留其他消息的相对顺序。
    session.messages = [
      ...session.messages.slice(0, assistantIndex),
      {
        ...assistant,
        parts: [
          // 保留助手正文和其他原有部件，仅在所属助手消息末尾补入工具调用。
          ...assistant.parts,
          {
            type: MessagePartType.TOOL_CALL,
            tool_call_id: execution.call.id,
            tool_name: execution.call.name,
            args: execution.call.args,
            // 此状态只供界面展示；buildModelHistory 只发送调用 ID、名称和原参数。
            status: result.success ? ToolCallStatus.COMPLETED : ToolCallStatus.FAILED,
          } satisfies ToolCallPart,
        ],
      },
      // 配对结果进入实际历史；显示投影会隐藏 tool 消息，下一次模型请求仍会携带其正文。
      message,
      ...session.messages.slice(assistantIndex + 1),
    ]
    // 成功、失败及 ask_user 回答都已保存为配对消息，不再保留完成记录，避免随聊天持续积累。
    // 必须在消息写入之后移除，执行中或待回答的问题记录仍保留，供进度展示和回答入口使用。
    delete session.toolExecutions[execution.assistantMessageId]
  }

  /** 数据归属不依赖展示选择、活动位或存储就绪状态。 */
  function ownsSession(run: AgentRun) {
    const session = run.session
    return (
      !run.lifecycle.aborted &&
      !disposed.value &&
      !identityInvalid.value &&
      sessions.value[session.id] === session &&
      user.currentUser.value?.id === session.userId &&
      config.projectId.value === session.projectId
    )
  }

  /** 入队固定快照后立即释放活动位；原异步调用不能再次发布或提交工具结果。 */
  function finalizeRun(
    run: AgentRun,
    status: StopStatus,
    finishes: { id: string; changes: Partial<LogSource> }[] = [],
  ) {
    if (run.finalized) return
    run.finalized = true
    const session = run.session
    if (run.committed && ownsSession(run)) {
      const current = run.modelCall
      if (current?.status === 'running')
        current.status = status === 'failed' ? 'failed' : 'cancelled'
      for (const execution of Object.values(session.toolExecutions)) {
        if (execution.modelCallId !== current?.id || status === 'waiting') continue
        const source = newLogSource('cancelled', {
          name: execution.call.name,
          args: execution.call.args,
        })
        source.started_at = execution.startedAt ?? source.started_at
        source.ended_at = new Date().toISOString()
        source.duration_ms = Date.parse(source.ended_at) - Date.parse(source.started_at)
        source.error = { code: 'TOOL_CANCELLED', result_committed: false }
        void telemetry.record(
          session,
          execution.resultSpanId ?? crypto.randomUUID(),
          'tool_result',
          source,
          execution.modelCallId,
          execution.call.id,
        )
        delete session.toolExecutions[execution.assistantMessageId]
      }
      const message = session.messages.find((m) => m.id === current?.assistantMessageId)
      if (current && run.awaitingCompletion)
        finishes.push({
          id: current.id,
          changes: {
            status: current.status,
            error: current.error,
            output: {
              message: {
                role: 'assistant',
                content: message
                  ? getMessageTextParts(message)
                      .map((p) => p.text)
                      .join('')
                  : '',
              },
            },
          },
        })
      session.messages = session.messages.filter(
        (message) =>
          message.id !== current?.assistantMessageId ||
          message.interaction ||
          message.parts.some((part) => part.type !== MessagePartType.TEXT || part.text.trim()),
      )
      void persistSession(session).catch(() => {})
      void telemetry.finishAndPublish(
        session,
        status,
        getMessageTextParts(
          session.messages.find((m) => m.role === AgentMessageRole.USER) ?? run.trigger,
        )
          .map((p) => p.text)
          .join(''),
        finishes,
      )
    }
    if (activeRun.value === run) activeRun.value = null
  }

  /** 自动推进只属于活动上下文；退出后保存、日志和取消分别自行收口。 */
  async function runLoop(session: AgentSession, submission?: LocalSubmission) {
    const control: AgentRun = {
      session,
      trigger: session.messages[session.messages.length - 1]!,
      model: new AbortController(),
      tool: new AbortController(),
      lifecycle: lifecycle.signal,
      stopped: false,
      finalized: false,
      modelCall: null,
      awaitingCompletion: false,
      committed: !submission,
    }
    activeRun.value = control
    const sessionId = session.id
    const userId = session.userId
    const projectId = session.projectId
    const isRunCurrent = () =>
      ownsSession(control) && activeRun.value === control && !control.stopped && ready.value
    try {
      // 首次消息与图片原子保存失败时回滚；后续运行错误不再影响草稿。
      try {
        await persistSession(session, submission)
      } catch (error) {
        if (!submission) throw error
        submission.rollback(error)
        return
      }
      control.committed = true
      submission?.commit()
      // 保存期间收到停止请求时，先记录已提交输入，再由 finally 完成取消收口。
      if (!ownsSession(control) || activeRun.value !== control) return
      const trigger = control.trigger
      void telemetry.activity(session, session.messages.length > 1)
      // 回答交互后由工具结果触发续轮，不再把该回答重复记录为用户输入节点。
      if (trigger.role === AgentMessageRole.USER)
        void telemetry.record(
          session,
          trigger.id,
          'user_message',
          newLogSource('completed', {
            content: getMessageTextParts(trigger).map((part) => ({
              type: 'text',
              text: part.text,
            })),
          }),
        )
      while (isRunCurrent()) {
        // 1. 等待旧模型调用释放槽位，再复核归属；只等待收口，不重放旧请求。
        await client.waitForIdle()
        if (!isRunCurrent()) return
        // 2. 从唯一消息记录生成快照，包括部分回复和已配对工具结果，不再额外追加首次输入。
        // 3. 新建 modelCall，记录用户消息或工具结果的输入 ID；助手消息按固定 ID 逐步保存。
        session.latestModelCall = {
          id: crypto.randomUUID(),
          status: 'running',
          inputMessageId: session.messages[session.messages.length - 1]!.id,
          assistantMessageId: crypto.randomUUID(),
          error: null,
        }
        const current = session.latestModelCall
        control.modelCall = current
        const imageUrls = await prepareAgentImages(
          session,
          sessionStore,
          AbortSignal.any([control.model.signal, control.lifecycle]),
          isRunCurrent,
        )
        if (!isRunCurrent()) return
        const request: StreamParams = {
          modelCallId: current.id,
          projectId,
          tools: JSON.parse(JSON.stringify(agentTools)) as StreamParams['tools'],
          messages: buildTextMessages(buildModelHistory(session, imageUrls)),
        }
        control.awaitingCompletion = true
        session.usageRecords[current.id] = { usage: null, chargedAmount: null }
        // 调用前记录实际请求输入，并把同一日志身份交给服务端关联供应商请求。
        const logIdentity = await telemetry.record(
          session,
          current.id,
          'model_call',
          newLogSource('running', {
            messages: request.messages,
            tools: request.tools,
          }),
          current.id,
        )
        if (!isRunCurrent()) return
        if (logIdentity) request.telemetry = logIdentity
        // 调用摘要在发送前落盘；完整请求已经写入诊断日志。
        await persistSession(session)
        if (!isRunCurrent()) return
        const output = await client.stream(request, { signal: control.model.signal })
        if (!isRunCurrent()) return
        // 4. 增量写入同一条助手消息，停止也不删除；工具参数仍须等待完整终态再处理。
        for await (const chunk of output) {
          if (!isRunCurrent() || session.latestModelCall?.id !== current.id) break
          if (!chunk.delta) continue
          const assistant = getAssistantMessage(session, current)
          const text = assistant.parts.find((part) => part.type === MessagePartType.TEXT)!
          if (text.type === MessagePartType.TEXT) text.text += chunk.delta
          // 每次增量保存固定快照并顺序写入，部分正文也属于实际会话内容。
          await persistSession(session)
        }
        const completion = await output.finalCompletion()
        // 等待期间可能已经停止或删除原会话；展示切换不会使原运行失效。
        if (!isRunCurrent() || session.latestModelCall?.id !== current.id) return
        const call = completion.message.tool_calls?.[0]
        // 5. 用完整终态校准正文，不另建消息或提前提交工具调用；模型完成不代表工具成功。
        const assistant = getAssistantMessage(session, current)
        assistant.parts = [{ type: MessagePartType.TEXT, text: completion.message.content }]
        control.awaitingCompletion = false
        session.usageRecords[current.id] = {
          usage: completion.usage,
          chargedAmount: completion.chargedAmount ?? null,
          contextWindowTokens: completion.contextWindowTokens,
        }
        current.status = 'completed'
        // 完成信息更新原模型节点；交互工具的分类只用于日志展示，不改变调用参数。
        const modelChanges: Partial<LogSource> = {
          status: 'completed',
          output: {
            message: {
              ...completion.message,
              ...(completion.message.tool_calls
                ? {
                    tool_calls: completion.message.tool_calls.map((tool) => ({
                      ...tool,
                      ...toolLogMetadata(tool.name),
                    })),
                  }
                : {}),
            },
            usage: completion.usage,
          },
        }
        // 最终回复同步交接，不等待保存或日志落盘。
        if (!call) {
          finalizeRun(control, 'completed', [{ id: current.id, changes: modelChanges }])
          return
        }
        await telemetry.finish(session, current.id, modelChanges)
        if (!isRunCurrent()) return
        // 6. 调用先只保存在执行记录中：普通工具进度由 UI 投影，ask_user 只展示问题卡片。
        session.toolExecutions[assistant.id] = {
          startedAt: new Date().toISOString(),
          resultSpanId: crypto.randomUUID(),
          userId,
          projectId,
          sessionId,
          modelCallId: current.id,
          assistantMessageId: assistant.id,
          call,
          status: 'pending',
          result: null,
        }
        // 从响应式字典取回记录，后续状态和结果更新才能同步驱动 UI。
        const execution = session.toolExecutions[assistant.id]!
        await persistSession(session)
        if (!isRunCurrent()) return
        let result: ToolResult
        try {
          // 校验位于工具处理范围内：参数非法时不执行工具，而是生成错误结果供模型下一轮修正。
          toolRuntime.validate(call)
          if (call.name === 'ask_user') {
            // ask_user 不立即执行或创建等待 Promise，只在助手消息中保存问题，由计算属性推导等待状态。
            // 问题交接释放活动位；用户回答时提交配对结果并启动新循环。
            const question = call.args as { question: string; suggested_options: string[] }
            assistant.interaction = {
              interrupt: {
                interaction_id: call.id,
                kind: 'ask_user',
                prompt: question.question,
                options: question.suggested_options,
                created_at: new Date().toISOString(),
              },
              result: null,
            }
            // 问题建立和释放活动位在同一同步交接内完成。
            finalizeRun(control, 'waiting')
            return
          }
          // 普通工具使用原执行器；传入取消信号和实时归属检查，适配层在异步准备后再次复核。
          result = await toolRuntime.execute(call, {
            toolCallId: call.id,
            userId,
            projectId,
            sessionId,
            modelCallId: current.id,
            signal: AbortSignal.any([control.tool.signal, control.lifecycle]),
            isCurrent: isRunCurrent,
          })
        } catch (error) {
          // 停止或会话失效后丢弃错误；活动工具的真实错误仍作为结果提交。
          if (!isRunCurrent()) return
          // 校验异常或执行异常转换为失败结果，保留错误正文；不重放原调用、不自动修改参数。
          const message = error instanceof Error ? error.message : String(error)
          result = { success: false, output: message, error: message }
        }
        // 停止后的所有工具结果只被消费，不再写入聊天和日志。
        if (!isRunCurrent()) return
        commitToolResult(session, execution, result)
        // 已完成工具只作为配对消息保存，执行详情由诊断日志记录。
        await persistSession(session)
        // 8. 回到 while 顶部；停止后不再进入下一轮，否则用新 modelCall 和结果继续，由模型决定修正或结束。
      }
    } catch (error) {
      // 外层处理模型/传输及循环本身的异常；工具异常已在内层转成结果，不会走到这里。
      // 原会话已经删除或身份清理后，旧循环不能覆盖新运行的 modelCall 或消息。
      if (!ownsSession(control) || activeRun.value !== control || control.finalized) return
      if (error instanceof Error && 'code' in error && error.code === 'AGENT_IMAGE_URL_EXPIRED') {
        await invalidateAgentImageUploads(session, sessionStore, () => ownsSession(control)).catch(
          (storageFailure: unknown) => reportStorageError(session, storageFailure),
        )
        if (!ownsSession(control) || activeRun.value !== control || control.finalized) return
      }
      const diagnostic = newLogSource('failed', { phase: 'orchestration' })
      diagnostic.error =
        error instanceof Error ? { name: error.name, message: error.message } : String(error)
      void telemetry.record(session, crypto.randomUUID(), 'diagnostic', diagnostic)
      if (control.modelCall?.status === 'running') {
        control.modelCall.error = error instanceof Error ? error.message : String(error)
        if (error instanceof Error && 'code' in error && typeof error.code === 'string')
          control.modelCall.errorCode = error.code
        control.modelCall.status = 'failed'
      }
      finalizeRun(control, 'failed')
    } finally {
      finalizeRun(
        control,
        control.stopped ? 'cancelled' : storageError.value ? 'failed' : 'completed',
      )
    }
  }

  /**
   * 接收当前 ask_user 的一次回答，在原助手消息中保存选择来源、回答及提交时间。
   * 回答作为原工具调用的 ASK_RESULT 保存，不新增一条用户消息，保持模型历史的调用/结果配对。
   * 保存回答后计算属性自动结束等待，再启动 runLoop 同步占用 running，重复点击或并发回答会被拒绝。
   */
  async function answerQuestion(answer: string, via: InteractionSubmittedVia = 'custom_input') {
    const content = answer.trim()
    if (
      !ready.value ||
      running.value ||
      localSubmission.value ||
      !content ||
      !pendingInteraction.value
    )
      return false
    // 发送准入由 pendingInteraction 统一判断；回答结果直接写回最后一条消息的交互记录。
    const message = currentMessages.value[currentMessages.value.length - 1]!
    const interaction = message.interaction
    // 通过问题所属助手消息直接定位执行记录，不再遍历所有历史调用。
    const execution = toolExecutions.value[message.id]
    if (!interaction || interaction.result || !execution) return false
    interaction.result = {
      interaction_id: interaction.interrupt.interaction_id,
      kind: 'ask_user',
      answer: content,
      submitted_via: via,
      submitted_at: new Date().toISOString(),
    }
    const session = currentSession.value!
    commitToolResult(session, execution, { success: true, output: `[ASK_RESULT]\n${content}` })
    await runLoop(session)
    return true
  }

  /** 发送新的用户消息；等待 ask_user 回答时拒绝发送，回答须通过 answerQuestion 单独提交。 */
  async function submitMessage(
    text: string,
    images: readonly AgentImage[],
    onCommitted?: () => void,
    onFailed?: (error: unknown) => void,
  ) {
    const content = text.trim()
    if (
      !ready.value ||
      running.value ||
      localSubmission.value ||
      pendingInteraction.value ||
      (!content && !images.length)
    )
      return false
    if (
      images.length > AGENT_IMAGE_LIMITS.count ||
      images.some(
        (image) =>
          !image.id ||
          image.userId !== user.currentUser.value?.id ||
          image.projectId !== config.projectId.value ||
          !image.original?.relativePath ||
          !image.conversionParams ||
          !image.blob.size ||
          image.blob.size > AGENT_IMAGE_LIMITS.encodedBytes ||
          image.conversionParams.mimeType !== 'image/webp' ||
          image.blob.type !== image.conversionParams.mimeType ||
          !Number.isInteger(image.conversionParams.width) ||
          !Number.isInteger(image.conversionParams.height) ||
          image.conversionParams.width <= 0 ||
          image.conversionParams.height <= 0 ||
          Math.max(image.conversionParams.width, image.conversionParams.height) >
            AGENT_IMAGE_LIMITS.edge,
      )
    )
      return false
    const session = currentSession.value!
    const previousUpdatedAt = session.updatedAt
    const previousImages = pendingImages.get(session.id)
    const message = buildDisplayMessage(crypto.randomUUID(), AgentMessageRole.USER, content)
    message.parts.unshift(
      ...images.map((image) => ({ type: MessagePartType.IMAGE as const, attachmentId: image.id })),
    )
    message.parts.push(captureBackgroundContext(registry))
    if (images.length)
      pendingImages.set(session.id, [
        ...(pendingImages.get(session.id) ?? []),
        ...images.map((image) => ({ ...image })),
      ])
    session.messages.push(message)
    const registeredImages = pendingImages.get(session.id)
    const releaseImages = images.map((image) => retainAgentAttachment(image.projectId, image.id))
    let settle!: () => void
    const settled = new Promise<void>((resolve) => {
      settle = () => {
        releaseImages.forEach((release) => release())
        resolve()
      }
    })
    const submission: LocalSubmission = {
      session,
      images,
      committed: false,
      settled,
      settle,
      commit() {
        submission.committed = true
        if (localSubmission.value === submission) {
          localSubmission.value = null
          onCommitted?.()
        }
        submission.settle()
      },
      rollback(error) {
        if (sessions.value[session.id] === session) {
          session.messages = session.messages.filter((item) => item.id !== message.id)
          session.updatedAt = previousUpdatedAt
          if (pendingImages.get(session.id) === registeredImages) {
            if (previousImages) pendingImages.set(session.id, previousImages)
            else pendingImages.delete(session.id)
          }
        }
        if (localSubmission.value === submission) {
          localSubmission.value = null
          onFailed?.(error)
        }
        submission.settle()
      },
    }
    localSubmission.value = submission
    await runLoop(session, submission)
    return submission.committed
  }

  function send(text: string, images: readonly AgentImage[] = []) {
    if (draft.value.submitting) return Promise.resolve(false)
    return submitMessage(text, images)
  }

  async function sendDraft() {
    if (!draftSendable.value) return false
    const snapshot = draft.value
    draft.value = { ...snapshot, submitting: true, submitError: null }
    const submittedDraft = draft.value
    const fail = (error: unknown) => {
      if (draft.value === submittedDraft)
        draft.value = {
          ...snapshot,
          submitting: false,
          submitError: error instanceof Error ? error.message : String(error),
        }
    }
    try {
      return await submitMessage(
        snapshot.text,
        snapshot.images.map((item) => item.image!),
        () => {
          if (draft.value === submittedDraft) resetDraft(true)
        },
        fail,
      )
    } catch (error) {
      fail(error)
      return false
    } finally {
      if (draft.value === submittedDraft) draft.value = { ...snapshot, submitting: false }
    }
  }

  async function getImage(id: string): Promise<{ blob: Blob; fileName: string }> {
    const session = currentSession.value
    if (!session) throw new Error('无法读取对话图片')
    const image =
      pendingImages.get(session.id)?.find((image) => image.id === id) ??
      (await sessionStore.readImage(session, id))
    if (!image) throw new AgentImageSourceError('AGENT_IMAGE_RECORD_MISSING')
    return { blob: await readAgentImageSource(image), fileName: image.original.fileName }
  }

  // 身份失效通知的取消订阅函数，模块释放时移除该监听。
  const unsubscribeIdentity = client.subscribeIdentityInvalid(
    /** 身份失效时停止并清空会话、关闭连接，阻止该身份再次发送。 */ () => {
      clearMemory()
      client.close('IDENTITY_INVALID')
      identityInvalid.value = true
    },
  )
  // 账户 ID 观察器的停止函数；仅身份变化触发清理，同账户余额更新不重置聊天。
  const stopIdentityWatch = watch(
    /** 仅观察账户 ID，余额等同账户数据更新不会触发会话清理。 */ () => user.currentUser.value?.id,
    /** 账户变化时隔离旧会话和连接，并解除旧身份的失效标记。 */ () => {
      clearMemory()
      client.close('IDENTITY_CHANGED')
      identityInvalid.value = false
    },
    { flush: 'sync' },
  )
  // 只在账户、工程及就绪分区变化时加载历史；展示选择、余额刷新不会触发读取或停止。
  const stopHistoryWatch = watch(
    /** 读取存储分区及工程就绪状态，同账户余额或展示选择不属于依赖。 */
    [
      () => user.currentUser.value?.id,
      () => config.projectId.value,
      () => project.isProjectSettingsReady.value && project.isProjectTimelineReady.value,
    ] as const,
    /** 加载本分区历史并展示空白聊天，不自动重发旧调用或恢复工具。 */
    async ([userId, projectId, projectReady], _previous, onCleanup) => {
      let current = true
      onCleanup(() => {
        current = false
      })
      historyLoading.value = true
      storageError.value = null
      if (!enabled || !userId || !projectId || !projectReady || disposed.value) return
      try {
        const saved = await sessionStore.load(userId, projectId)
        if (!current) return
        for (const session of saved) {
          // 只恢复聊天数据和待回答问题，不恢复模型或普通工具执行。
          if (session.latestModelCall?.status === 'running')
            session.latestModelCall.status = 'cancelled'
          sessions.value[session.id] = session
        }
        newChat()
        void telemetry.resume(userId, projectId)
      } catch (error) {
        if (current) storageError.value = error instanceof Error ? error.message : String(error)
      } finally {
        if (current) historyLoading.value = false
      }
    },
    { immediate: true, flush: 'sync' },
  )
  const stopProjectWatch = watch(
    () => config.projectId.value,
    () => leaveProject(),
    { flush: 'sync' },
  )
  // 工程就绪观察器的停止函数；工程退出就绪状态时清空临时会话并关闭连接。
  const stopReadyWatch = watch(
    /** 合并工程设置与时间轴的就绪状态，判断工程是否仍可使用。 */ () =>
      project.isProjectSettingsReady.value && project.isProjectTimelineReady.value,
    /** 工程退出就绪状态时执行页面离开的统一清理。 */ (value) => {
      if (!value) leaveProject()
    },
    { flush: 'sync' },
  )
  globalThis.window?.addEventListener('pagehide', leaveProject)
  // 断网期间的快照已保存在 IndexedDB，网络恢复后仅补传当前账号和工程的数据。
  const resumeLogs = () => {
    const userId = user.currentUser.value?.id
    if (userId && config.projectId.value) void telemetry.resume(userId, config.projectId.value)
  }
  globalThis.window?.addEventListener('online', resumeLogs)
  onScopeDispose(
    /** 作用域释放时停止运行，移除所有监听和订阅，最终销毁客户端并禁止发送。 */ () => {
      leaveProject()
      disposed.value = true
      stopIdentityWatch()
      stopReadyWatch()
      stopProjectWatch()
      stopHistoryWatch()
      unsubscribeIdentity()
      unsubscribeConnection()
      globalThis.window?.removeEventListener('pagehide', leaveProject)
      client.dispose()
      telemetry.dispose()
      globalThis.window?.removeEventListener('online', resumeLogs)
    },
  )
  return {
    ready,
    running: readonly(currentRunning),
    busy: readonly(running),
    activeSessionId: readonly(activeSessionId),
    sessionHistory: readonly(sessionHistory),
    historyLoading: readonly(historyLoading),
    storageError: readonly(storageError),
    currentSessionId: readonly(currentSessionId),
    currentMessages: readonly(displayMessages),
    latestModelCall: readonly(latestModelCall),
    usage: readonly(usage),
    contextUsage: readonly(contextUsage),
    toolExecutions: readonly(toolExecutions),
    pendingInteraction: readonly(pendingInteraction),
    connection: readonly(connection),
    draft: readonly(draft),
    draftEditable: readonly(draftEditable),
    draftSendable: readonly(draftSendable),
    setDraftText,
    addDraftImages,
    removeDraftImage,
    retryDraftImage,
    clearDraft,
    sendDraft,
    send,
    getImage,
    answerQuestion,
    stop,
    newChat,
    selectSession,
    deleteSession,
    leaveProject,
  }
}

export type UnifiedAgentModule = ReturnType<typeof createUnifiedAgentModule>
