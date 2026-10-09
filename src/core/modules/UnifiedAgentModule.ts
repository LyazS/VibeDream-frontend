import { computed, onScopeDispose, readonly, ref, watch } from 'vue'
import { API_BASE_URL } from '@/config/runtimeConfig'
import { FRAME_RATE } from '@/constants/TimeConstants'
import { buildTextMessages } from '@/core/agent/prompts/textMessages'
import { agentTools, createToolRuntime } from '@/core/agent/runtime/ToolRuntime'
import { AgentSessionStore } from '@/core/agent/runtime/AgentSessionStore'
import { AgentTelemetry, newLogSource } from '@/core/agent/runtime/AgentTelemetry'
import { toolLogMetadata } from '@/core/agent/telemetry/agent-log'
import type { ToolResult } from '@/core/agent/tools/types'
import {
  AgentClient,
  type ConnectionState,
  type StreamParams,
  type ModelMessage,
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
  type ModelCall,
  type ToolExecution,
} from '@/core/agent/types'
import { MODULE_NAMES, type ModuleMap, type ModuleRegistry } from './ModuleRegistry'

/** 创建工程级 Agent 模块，管理本地会话、模型调用及生命周期，并导出只读状态和操作。 */
export function createUnifiedAgentModule(registry: ModuleRegistry) {
  // 当前账户来源，用于发送准入、身份变化监听和异步结果归属检查。
  const user = registry.get<ModuleMap['user']>(MODULE_NAMES.USER)
  // 工程 ID 和名称来源，每次发送时读取并保存到请求快照。
  const config = registry.get<ModuleMap['config']>(MODULE_NAMES.CONFIG)
  // 工程加载状态来源，设置和时间轴均就绪后才允许发送。
  const project = registry.get<ModuleMap['project']>(MODULE_NAMES.PROJECT)
  // 当前选中片段来源，将选中 ID 复制到本轮工程上下文。
  const selection = registry.get<ModuleMap['selection']>(MODULE_NAMES.SELECTION)
  // 服务端明确通知身份失效后阻止发送，账户 ID 变化时重置。
  const identityInvalid = ref(false)
  // 构建环境开关，目前仅在本地开发和 Preview 启用新 Agent。
  const enabled = import.meta.env.DEV || import.meta.env.MODE === 'preview'
  // 模块是否已最终释放；释放后即使工程和账户有效，也不能再发送。
  const disposed = ref(false)
  // 会话存储和当前账户/工程的内存索引。
  const sessionStore = new AgentSessionStore()
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
  // 当前或最近一次模型调用，保存归属、完整请求快照、终态结果和错误；正文只保存在消息列表。
  const latestModelCall = computed(() => currentSession.value?.latestModelCall ?? null)
  // 工程运行槽所属会话，空闲/等待问题时为 null，与当前展示 ID 相互独立。
  const activeSessionId = ref<string | null>(null)
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
  // 工具运行时调用编辑器执行器及撤销命令。
  const toolRuntime = createToolRuntime()
  // 客户端连接状态的响应式镜像，供顶栏展示连接颜色及读取关闭原因。
  const connection = ref<ConnectionState>({
    status: 'disconnected',
    closeReason: null,
    error: null,
  })
  // 模型和工具分别取消；停止会取消素材读取/检索，生命周期清理取消所有工具。
  let controller: { model: AbortController; tool: AbortController; sessionId: string } | undefined

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

  /** 保存固定会话快照；存储异常阻止新请求，详细恢复策略留待阶段 3.4。 */
  async function persistSession(session: AgentSession, execution?: ToolExecution) {
    session.updatedAt = new Date().toISOString()
    try {
      await sessionStore.save(session, execution)
    } catch (error) {
      if (sessions.value[session.id] === session) {
        storageError.value = error instanceof Error ? error.message : String(error)
      }
      throw error
    }
  }

  // 模块唯一持有的工程级客户端，跨轮次和面板显隐复用，模块释放时销毁。
  const client = new AgentClient({
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
  function getAssistantMessage(session: AgentSession, modelCall: ModelCall): AgentMessage {
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

  /** 停止续轮并取消素材读取/检索；其他已开始工具保存实际结果，保留部分回复和问题。 */
  function stop() {
    const control = controller
    if (!control || control.sessionId !== currentSessionId.value) return
    control.model.abort()
    const cancellable = Object.values(toolExecutions.value).some(
      (execution) =>
        execution.status === 'pending' &&
        (execution.call.name === 'read_media' || execution.call.name === 'search_media'),
    )
    if (cancellable) control.tool.abort()
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
    controller?.model.abort()
    controller?.tool.abort()
    controller = undefined
    sessions.value = {}
    activeSessionId.value = null
    newChat()
  }

  /** 删除空闲会话和对应日志；运行及取消收口期间拒绝删除，须先停止并等待结束。 */
  async function deleteSession(id: string) {
    const session = sessions.value[id]
    // 模块入口也检查运行归属，避免绕过界面禁用或点击时状态变化导致删除在途会话。
    if (!session || activeSessionId.value === id) return false
    delete sessions.value[id]
    if (currentSessionId.value === id) newChat()
    await sessionStore.delete(session)
    await telemetry.delete(session)
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
  function buildModelHistory(session: AgentSession): ModelMessage[] {
    // 每次请求都从运行所属会话重新生成协议消息，保持对话顺序；与 UI 展示选择无关，不缓存第二份历史。
    // 系统提示词和最新工程上下文由 runLoop 中的 buildTextMessages() 另外添加。
    const history: ModelMessage[] = []
    for (const message of session.messages) {
      // 只提取 TEXT 部件，逐段复制到 content 数组，保留原有顺序、边界、空格和换行。
      // 工具调用另行映射，进度和交互元数据不转成正文。
      const content = getMessageTextParts(message).map((part) => ({
        type: 'text' as const,
        text: part.text,
      }))

      // 1. 工具结果作为独立的 tool 消息返回模型，成功、失败及参数校验错误都走此分支。
      // 文本部件内保存原工具输出或错误正文，不解析为 JSON，也不额外编码工具输出。
      // ask_user 的回答已经由 answerQuestion 写成 [ASK_RESULT]，在这里与其他工具结果同样处理。
      if (message.role === 'tool') {
        history.push({
          role: 'tool',
          content,
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
          content,
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
      } else if (content.some((part) => part.text.trim())) {
        // 3. 普通用户/助手正文只要不是全空白就进入历史，不根据 modelCall 成功或中断状态过滤。
        // 所以失败前的用户输入、已经收到的部分助手回复都会进入用户下一次提交的请求。
        // 任意一段不是全空白就保留整条消息及全部文本部件；trim() 不修改实际发送的文本。
        history.push({ role: message.role, content })
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

  /**
   * 自动推进：实际消息历史 -> 单次模型调用 -> 保存正文 -> 执行工具 -> 成对保存结果 -> 新 modelCall。
   * 用户输入和 ask_user 回答都已写入消息列表，不额外传入或重复追加；每轮使用新 ID 和请求快照。
   * 文本增量直接更新本轮唯一助手消息，中断保留已收到内容，只有完整终态才能启动工具。
   * 停止取消模型及素材读取/检索并丢弃其结果，其他已开始工具保存结果；会话失效丢弃全部迟到结果。
   * running 覆盖模型、普通工具和客户端取消收口；ask_user 保存问题后退出，不占运行槽等待回答。
   * 工具错误成对返回模型供下一轮修正；模型/传输异常停止，由用户输入新指令继续，不自动重试。
   */
  async function runLoop(session: AgentSession, answeredTool?: ToolExecution) {
    // 先同步占用运行槽；模型与工具分别取消，执行收口前不允许新运行并发。
    const control = {
      model: new AbortController(),
      tool: new AbortController(),
      sessionId: session.id,
    }
    controller = control
    const sessionId = session.id
    const userId = session.userId
    const projectId = session.projectId
    activeSessionId.value = sessionId
    /** 检查原会话仍存在且运行归属有效；展示切换、新建不影响，删除/身份/工程失效才隔离。 */
    const isRunOwned = () =>
      sessions.value[sessionId] === session &&
      controller === control &&
      ready.value &&
      user.currentUser.value?.id === userId &&
      config.projectId.value === projectId
    /** 除归属有效外，还要求没有普通停止信号；用于模型调用和自动续轮的推进准入。 */
    const isRunCurrent = () => isRunOwned() && !control.model.signal.aborted
    try {
      const trigger = session.messages[session.messages.length - 1]!
      await telemetry.activity(session, session.messages.length > 1)
      // 回答交互后由工具结果触发续轮，不再把该回答重复记录为用户输入节点。
      if (trigger.role === AgentMessageRole.USER)
        await telemetry.record(
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
      // 先保存触发消息（用户输入或回答后的工具对）；运行槽已同步占用，保存期间不能并发发送。
      await persistSession(session, answeredTool)
      while (isRunCurrent()) {
        // 1. 等待旧模型调用释放槽位，再复核归属；只等待收口，不重放旧请求。
        await client.waitForIdle()
        if (!isRunCurrent()) return
        // 2. 从唯一消息记录生成快照，包括部分回复和已配对工具结果，不再额外追加首次输入。
        const request: StreamParams = {
          modelCallId: crypto.randomUUID(),
          projectId,
          tools: JSON.parse(JSON.stringify(agentTools)) as StreamParams['tools'],
          messages: buildTextMessages(buildModelHistory(session), {
            projectId,
            projectName: config.projectName.value,
            fps: FRAME_RATE,
            selectedClipIds: [...selection.selectedClipTimelineItemIds.value],
          }),
        }
        // 3. 新建 modelCall，记录用户消息或工具结果的输入 ID；助手消息按固定 ID 逐步保存。
        session.latestModelCall = {
          id: request.modelCallId,
          status: 'running',
          sessionId,
          userId,
          projectId,
          inputMessageId: session.messages[session.messages.length - 1]!.id,
          assistantMessageId: crypto.randomUUID(),
          request,
          completion: null,
          error: null,
        }
        const current = session.latestModelCall
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
        if (logIdentity) request.telemetry = logIdentity
        // 请求快照在调用前落盘，modelCall 与原会话关联；切换展示不会改变这一引用。
        await persistSession(session)
        if (!isRunCurrent()) return
        const output = await client.stream(request, { signal: control.model.signal })
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
        current.completion = completion
        current.status = 'completed'
        // 完成信息更新原模型节点；交互工具的分类只用于日志展示，不改变调用参数。
        await telemetry.finish(session, current.id, {
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
        })
        // 没有工具调用就是最终回复，本次自动推进结束；finally 负责释放运行状态。
        if (!call) {
          await persistSession(session)
          return
        }
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
            // 返回后 finally 释放 running；用户回答时由 answerQuestion 提交配对结果，再启动新循环。
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
            // 问题和原调用记录一起保存；刷新后仅恢复问题卡片，不恢复旧循环或等待 Promise。
            await persistSession(session)
            return
          }
          // 普通工具使用原执行器；传入取消信号和实时归属检查，适配层在异步准备后再次复核。
          result = await toolRuntime.execute(call, {
            toolCallId: call.id,
            userId,
            projectId,
            sessionId,
            modelCallId: current.id,
            signal: control.tool.signal,
            isCurrent: () => isRunOwned() && !control.tool.signal.aborted,
          })
        } catch (error) {
          // 会话失效后不能写入；其他工具的真实错误仍保存，素材工具取消在提交前统一检查。
          if (!isRunOwned()) return
          // 校验异常或执行异常转换为失败结果，保留错误正文；不重放原调用、不自动修改参数。
          const message = error instanceof Error ? error.message : String(error)
          result = { success: false, output: message, error: message }
        }
        // 7. 停止取消的素材工具不提交结果；其他工具复核归属后成对保存。
        if (!isRunOwned()) return
        if (control.tool.signal.aborted) return
        commitToolResult(session, execution, result)
        // 内存只保留未完成执行；完成记录与消息对在同一事务中写入独立 ToolJournal。
        await persistSession(session, execution)
        // 8. 回到 while 顶部；停止后不再进入下一轮，否则用新 modelCall 和结果继续，由模型决定修正或结束。
      }
    } catch (error) {
      // 外层处理模型/传输及循环本身的异常；工具异常已在内层转成结果，不会走到这里。
      // 原会话已经删除或身份清理后，旧循环不能覆盖新运行的 modelCall 或消息。
      if (sessions.value[sessionId] !== session || controller !== control) return
      const diagnostic = newLogSource('failed', { phase: 'orchestration' })
      diagnostic.error =
        error instanceof Error ? { name: error.name, message: error.message } : String(error)
      await telemetry.record(session, crypto.randomUUID(), 'diagnostic', diagnostic)
      if (session.latestModelCall) {
        session.latestModelCall.error = error instanceof Error ? error.message : String(error)
        session.latestModelCall.status = control.model.signal.aborted ? 'cancelled' : 'failed'
      }
    } finally {
      // 本地取消消费后，客户端可能仍等待服务端终态；收口完成前保持运行槽占用。
      if (sessions.value[sessionId] === session && controller === control)
        await client.waitForIdle()
      // 等待期间可能删除会话或切换身份，只清理仍由本次运行持有的状态；普通展示切换不影响。
      if (sessions.value[sessionId] === session && controller === control) {
        // 被停止的素材工具以 cancelled 收口日志，不留下 pending 或未配对的模型历史。
        const cancelledTool = control.tool.signal.aborted
          ? Object.values(session.toolExecutions).find(
              (execution) => execution.modelCallId === session.latestModelCall?.id,
            )
          : undefined
        if (cancelledTool) {
          cancelledTool.status = 'cancelled'
          cancelledTool.result = null
          // 记录工具已取消且结果未提交，便于区分“没有执行结果”和“结果正文缺失”。
          const source = newLogSource('cancelled', {
            name: cancelledTool.call.name,
            args: cancelledTool.call.args,
          })
          source.error = { code: 'TOOL_CANCELLED', result_committed: false }
          cancelledTool.resultSpanId ??= crypto.randomUUID()
          await telemetry.record(
            session,
            cancelledTool.resultSpanId,
            'tool_result',
            source,
            cancelledTool.modelCallId,
            cancelledTool.call.id,
          )
          delete session.toolExecutions[cancelledTool.assistantMessageId]
        }
        if (session.latestModelCall) {
          if (session.latestModelCall.status === 'running')
            session.latestModelCall.status = 'cancelled'
          if (
            session.latestModelCall.status !== 'completed' &&
            !session.latestModelCall.completion
          ) {
            const call = session.latestModelCall
            const message = session.messages.find((m) => m.id === call.assistantMessageId)
            // 失败或取消也保留已接收的部分回复，完成当前节点而非留下永久 running。
            await telemetry.finish(session, call.id, {
              status: call.status,
              error: call.error,
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
            })
          }
        }
        session.messages = session.messages.filter(
          (message) =>
            message.id !== session.latestModelCall?.assistantMessageId ||
            message.interaction ||
            message.parts.some((part) => part.type !== MessagePartType.TEXT || part.text.trim()),
        )
        try {
          await persistSession(session, cancelledTool)
        } finally {
          // 等待用户回答也是一次发布边界；下一次续轮仍属于同一聊天日志。
          const last = session.messages[session.messages.length - 1]
          const status = control.model.signal.aborted
            ? 'cancelled'
            : last?.interaction && !last.interaction.result
              ? 'waiting'
              : session.latestModelCall?.status === 'failed'
                ? 'failed'
                : 'completed'
          await telemetry.publish(
            session,
            status,
            session.messages
              .find((m) => m.role === AgentMessageRole.USER)
              ?.parts.filter((p) => p.type === MessagePartType.TEXT)
              .map((p) => p.text)
              .join('') ?? '',
          )
          // 保存期间也可能删除会话或切换身份，只释放仍由本循环持有的工程槽。
          if (controller === control) {
            controller = undefined
            activeSessionId.value = null
          }
        }
      }
    }
  }

  /**
   * 接收当前 ask_user 的一次回答，在原助手消息中保存选择来源、回答及提交时间。
   * 回答作为原工具调用的 ASK_RESULT 保存，不新增一条用户消息，保持模型历史的调用/结果配对。
   * 保存回答后计算属性自动结束等待，再启动 runLoop 同步占用 running，重复点击或并发回答会被拒绝。
   */
  async function answerQuestion(answer: string, via: InteractionSubmittedVia = 'custom_input') {
    const content = answer.trim()
    if (!ready.value || running.value || !content || !pendingInteraction.value) return false
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
    await runLoop(session, execution)
    return true
  }

  /** 发送新的用户消息；等待 ask_user 回答时拒绝发送，回答须通过 answerQuestion 单独提交。 */
  async function send(text: string) {
    const content = text.trim()
    if (!ready.value || running.value || pendingInteraction.value || !content) return false
    const session = currentSession.value!
    session.messages.push(buildDisplayMessage(crypto.randomUUID(), AgentMessageRole.USER, content))
    await runLoop(session)
    return true
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
          // 不恢复旧任务。普通工具遗留 pending 的异常恢复属于 3.4；ask_user 数据保持可回答。
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
    toolExecutions: readonly(toolExecutions),
    pendingInteraction: readonly(pendingInteraction),
    connection: readonly(connection),
    send,
    answerQuestion,
    stop,
    newChat,
    selectSession,
    deleteSession,
    leaveProject,
  }
}

export type UnifiedAgentModule = ReturnType<typeof createUnifiedAgentModule>
