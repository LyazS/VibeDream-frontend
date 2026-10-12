import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { effectScope, ref, toRaw, type EffectScope } from 'vue'
import { IDBFactory } from 'fake-indexeddb'
import { indexedDBService } from '../src/core/storage/IndexedDBService'
import { AgentSessionStore } from '../src/core/agent/runtime/AgentSessionStore'
import { enabledApiCapabilities } from '../src/config/apiCapabilities'
import { ModuleRegistry } from '../src/core/modules/ModuleRegistry'
import { createUnifiedAgentModule } from '../src/core/modules/UnifiedAgentModule'
import type { Completion, StreamParams } from '../src/core/agent/transport/AgentClient'
import { createToolRuntime, agentTools } from '../src/core/agent/runtime/ToolRuntime'
import { MessagePartType, type AgentMessagePart } from '../src/core/agent/types'
import type { AgentUsageRecord } from '../src/core/agent/runtime/AgentUsage'
import type { VirtualDirectory } from '../src/core/directory/types'
import systemPrompt from '../src/core/agent/prompts/system-prompt.txt?raw'

const transport = vi.hoisted(() => ({
  calls: vi.fn(),
  close: vi.fn(),
  dispose: vi.fn(),
  created: vi.fn(),
  identity: undefined as (() => void) | undefined,
  idle: vi.fn(),
  settlement: undefined as ((id: string, record: AgentUsageRecord) => void) | undefined,
}))
const toolExecution = vi.hoisted(() => vi.fn())
vi.mock('../src/core/agent/tools', () => ({ executeTool: toolExecution }))
vi.mock('../src/core/agent/transport/AgentClient', () => ({
  AgentClient: class {
    constructor(options: { onSettlement: typeof transport.settlement }) {
      transport.created()
      transport.settlement = options.onSettlement
    }
    stream = transport.calls
    close = transport.close
    dispose = transport.dispose
    waitForIdle = transport.idle
    subscribeConnection(listener: (value: unknown) => void) {
      listener({ status: 'disconnected', closeReason: null, error: null })
      return vi.fn()
    }
    subscribeIdentityInvalid(listener: () => void) {
      transport.identity = listener
      return vi.fn()
    }
  },
}))
let scope: EffectScope
let agent: ReturnType<typeof createUnifiedAgentModule>
let windowTarget: EventTarget
let user: { currentUser: ReturnType<typeof ref<{ id: string; balance: string } | null>> }
let config: {
  projectId: ReturnType<typeof ref<string>>
  projectName: ReturnType<typeof ref<string>>
}
let project: {
  isProjectSettingsReady: ReturnType<typeof ref<boolean>>
  isProjectTimelineReady: ReturnType<typeof ref<boolean>>
}
let selection: {
  selectedClipTimelineItemIds: ReturnType<typeof ref<string[]>>
  selectedLibraryAssetIds: ReturnType<typeof ref<Set<string>>>
}
let directories: ReturnType<typeof ref<Map<string, VirtualDirectory>>>
let currentDirectory: ReturnType<typeof ref<VirtualDirectory | null>>
let currentFrame: ReturnType<typeof ref<number>>
let viewport: {
  TimelineContentWidth: ReturnType<typeof ref<number>>
  totalDurationFrames: ReturnType<typeof ref<number>>
  zoomLevel: ReturnType<typeof ref<number>>
  scrollOffset: ReturnType<typeof ref<number>>
  maxVisibleDurationFrames: ReturnType<typeof ref<number>>
}

function userContent(text: string) {
  return [
    { type: 'text', text: expect.stringMatching(/^\[BACKGROUND_CONTEXT\]\n/) },
    { type: 'text', text },
  ]
}

function output(
  request: StreamParams,
  final = Promise.resolve<Completion>({
    modelCallId: request.modelCallId,
    message: { role: 'assistant', content: 'complete reply' },
    usage: null,
  }),
) {
  return {
    async *[Symbol.asyncIterator]() {
      yield { delta: 'partial draft' }
    },
    finalCompletion() {
      return final
    },
  }
}
/** 重建模块模拟刷新；沿用同一 IndexedDB 和账户/工程，不恢复旧运行。 */
function mountAgent() {
  const registry = new ModuleRegistry()
  registry.register('user', user)
  registry.register('config', config)
  registry.register('project', project)
  registry.register('selection', selection)
  registry.register('directory', {
    directories,
    currentDir: currentDirectory,
    getDirectory: (id: string) => directories.value.get(id),
    getAssetDirectoryId: (id: string) => (id === 'media1' ? 'dir_video' : null),
  })
  registry.register('media', {
    getAsset: (id: string) =>
      id === 'media1' ? { id, name: 'Video', assetKind: 'media' } : undefined,
  })
  registry.register('playback', { currentFrame })
  registry.register('viewport', viewport)
  scope = effectScope()
  agent = scope.run(() => createUnifiedAgentModule(registry))!
}
beforeEach(async () => {
  vi.clearAllMocks()
  transport.idle.mockResolvedValue(undefined)
  windowTarget = new EventTarget()
  vi.stubGlobal('window', windowTarget)
  indexedDBService.close()
  vi.stubGlobal('indexedDB', new IDBFactory())
  user = { currentUser: ref({ id: 'u1', balance: '0' }) }
  config = { projectId: ref('p1'), projectName: ref('Test') }
  project = { isProjectSettingsReady: ref(true), isProjectTimelineReady: ref(true) }
  selection = {
    selectedClipTimelineItemIds: ref(['clip1']),
    selectedLibraryAssetIds: ref(new Set()),
  }
  directories = ref(new Map())
  currentDirectory = ref(null)
  currentFrame = ref(0)
  viewport = {
    TimelineContentWidth: ref(800),
    totalDurationFrames: ref(1800),
    zoomLevel: ref(1),
    scrollOffset: ref(0),
    maxVisibleDurationFrames: ref(1800),
  }
  mountAgent()
  transport.calls.mockImplementation(async (request: StreamParams) =>
    output(structuredClone(request)),
  )
  toolExecution.mockResolvedValue({ success: true, output: 'original tool output' })
  await vi.waitFor(() => expect(agent.historyLoading.value).toBe(false))
})
afterEach(() => {
  scope.stop()
  vi.unstubAllGlobals()
})

describe('persisted Agent sessions', () => {
  it('blocks sending when the Agent capability is disabled even in development', async () => {
    scope.stop()
    const capabilityCheck = vi.spyOn(enabledApiCapabilities, 'has').mockReturnValue(false)
    try {
      mountAgent()
      expect(agent.ready.value).toBe(false)
      expect(await agent.send('hello')).toBe(false)
      expect(transport.calls).not.toHaveBeenCalled()
    } finally {
      capabilityCheck.mockRestore()
    }
  })

  it('allows the Agent capability to enable sending in a production build mode', async () => {
    scope.stop()
    vi.stubEnv('DEV', false)
    vi.stubEnv('MODE', 'production')
    try {
      mountAgent()
      await vi.waitFor(() => expect(agent.ready.value).toBe(true))
      expect(await agent.send('hello')).toBe(true)
      expect(transport.calls).toHaveBeenCalledOnce()
    } finally {
      vi.unstubAllEnvs()
    }
  })

  it('persists cumulative usage once per call and isolates the selected session', async () => {
    const usage = { inputTokens: 10, outputTokens: 2, totalTokens: 12, cachedInputTokens: 8 }
    transport.calls.mockImplementation(async (request: StreamParams) => {
      const record = { usage, chargedAmount: '0.00000001', contextWindowTokens: 1000000 }
      transport.settlement?.(request.modelCallId, record)
      transport.settlement?.(request.modelCallId, record)
      return output(
        request,
        Promise.resolve({
          modelCallId: request.modelCallId,
          message: { role: 'assistant', content: 'reply' },
          ...record,
        }),
      )
    })
    await agent.send('first')
    await agent.send('second')
    expect(agent.usage.value.inputTokens).toEqual({ value: 20, complete: true })
    expect(agent.usage.value.chargedAmount).toEqual({ value: '0.00000002', complete: true })
    const id = agent.currentSessionId.value
    agent.newChat()
    expect(agent.usage.value.inputTokens.value).toBe(0)
    scope.stop()
    mountAgent()
    await vi.waitFor(() => expect(agent.ready.value).toBe(true))
    agent.selectSession(id)
    expect(agent.usage.value.inputTokens.value).toBe(20)
    expect(agent.usage.value.chargedAmount.value).toBe('0.00000002')
    expect(agent.contextUsage.value).toEqual({
      usedTokens: 12,
      limitTokens: 1000000,
      ratio: 0.000012,
    })
  })

  it('restores session usage without treating absent charges or cache as zero', async () => {
    transport.calls.mockImplementation(async (request: StreamParams) =>
      output(
        request,
        Promise.resolve({
          modelCallId: request.modelCallId,
          message: { role: 'assistant', content: 'old reply' },
          usage: { inputTokens: 10, outputTokens: 2, totalTokens: 12 },
        }),
      ),
    )
    await agent.send('first')
    await agent.send('second')
    const session = (await new AgentSessionStore().load('u1', 'p1'))[0]
    expect(Object.keys(session.usageRecords)).toHaveLength(2)
    scope.stop()
    mountAgent()
    await vi.waitFor(() => expect(agent.ready.value).toBe(true))
    agent.selectSession(session.id)
    expect(agent.usage.value.inputTokens).toEqual({ value: 20, complete: true })
    expect(agent.usage.value.cachedInputTokens).toEqual({ value: null, complete: false })
    expect(agent.usage.value.chargedAmount).toEqual({ value: null, complete: false })
  })

  it('records a late cancellation settlement on its original session and preserves it on reload', async () => {
    transport.calls.mockImplementationOnce(
      async (request: StreamParams, options: { signal: AbortSignal }) => {
        const final = new Promise<Completion>((_resolve, reject) => {
          options.signal.addEventListener('abort', () => reject(new Error('cancelled')))
        })
        // 与真实客户端一致，在消费者取得 finalCompletion 前接住取消拒绝。
        void final.catch(() => {})
        return output(request, final)
      },
    )
    const id = agent.currentSessionId.value
    const run = agent.send('cancel this request')
    await vi.waitFor(() => expect(transport.calls).toHaveBeenCalledOnce())
    const modelCallId = agent.latestModelCall.value!.id
    agent.stop()
    await run
    agent.newChat()
    const record = {
      usage: { inputTokens: 10, outputTokens: 2, totalTokens: 12, cachedInputTokens: 8 },
      chargedAmount: '0.0000156',
    }
    transport.settlement?.(modelCallId, record)
    transport.settlement?.(modelCallId, record)
    expect(agent.usage.value.inputTokens.value).toBe(0)
    await vi.waitFor(async () => {
      const sessions = await new AgentSessionStore().load('u1', 'p1')
      expect(sessions.find((session) => session.id === id)?.usageRecords?.[modelCallId]).toEqual(
        record,
      )
    })
    scope.stop()
    mountAgent()
    await vi.waitFor(() => expect(agent.ready.value).toBe(true))
    agent.selectSession(id)
    expect(agent.usage.value.chargedAmount).toEqual({ value: '0.0000156', complete: true })
    user.currentUser.value = { id: 'another-user', balance: '0' }
    transport.settlement?.(modelCallId, record)
    expect(agent.usage.value.inputTokens.value).toBe(0)
  })

  it('rejects deleting an active model session even while viewing another session', async () => {
    let finish!: (value: Completion) => void
    transport.calls.mockImplementationOnce(async (request: StreamParams) =>
      output(
        request,
        new Promise((resolve) => {
          finish = resolve
        }),
      ),
    )
    const id = agent.currentSessionId.value
    const run = agent.send('运行中的会话')
    await vi.waitFor(() => expect(transport.calls).toHaveBeenCalledOnce())
    const modelCallId = agent.latestModelCall.value!.id
    agent.newChat()
    expect(await agent.deleteSession(id)).toBe(false)
    expect(agent.busy.value).toBe(true)
    expect(agent.activeSessionId.value).toBe(id)
    expect(agent.selectSession(id)).toBe(true)
    expect(agent.currentMessages.value[0].parts[0]).toEqual({ type: 'text', text: '运行中的会话' })
    expect(transport.calls.mock.calls[0][1].signal.aborted).toBe(false)
    finish({ modelCallId, message: { role: 'assistant', content: '正常完成' }, usage: null })
    await run
    expect(await agent.deleteSession(id)).toBe(true)
    expect(await new AgentSessionStore().load('u1', 'p1')).toEqual([])
  })

  it('allows deleting another idle session without cancelling the active session', async () => {
    await agent.send('已完成会话')
    const idleId = agent.currentSessionId.value
    agent.newChat()
    const activeId = agent.currentSessionId.value
    let finish!: (value: Completion) => void
    transport.calls.mockImplementationOnce(async (request: StreamParams) =>
      output(
        request,
        new Promise((resolve) => {
          finish = resolve
        }),
      ),
    )
    const run = agent.send('另一个正在运行')
    await vi.waitFor(() => expect(transport.calls).toHaveBeenCalledTimes(2))
    const modelCallId = agent.latestModelCall.value!.id
    expect(await agent.deleteSession(idleId)).toBe(true)
    expect(agent.activeSessionId.value).toBe(activeId)
    expect(agent.selectSession(idleId)).toBe(false)
    expect(transport.calls.mock.calls[1][1].signal.aborted).toBe(false)
    finish({ modelCallId, message: { role: 'assistant', content: '完成' }, usage: null })
    await run
  })
  it('queues fixed snapshots so later reactive changes do not change an already submitted write', async () => {
    await agent.send('原输入')
    const store = new AgentSessionStore()
    const session = (await store.load('u1', 'p1'))[0]
    const text = session.messages[0].parts[0]
    if (text.type !== MessagePartType.TEXT) throw new Error('TEXT_REQUIRED')
    text.text = '第一份快照'
    const first = store.save(session)
    text.text = '第二份快照'
    const second = store.save(session)
    text.text = '未提交的后续修改'
    await Promise.all([first, second])
    const saved = (await store.load('u1', 'p1'))[0]
    expect(saved.messages[0].parts[0]).toEqual({ type: 'text', text: '第二份快照' })
  })
  it.each(['running', 'failed'] as const)(
    'restores a %s call summary without replaying the call',
    async (status) => {
      await agent.send('original input')
      const store = new AgentSessionStore()
      const session = (await store.load('u1', 'p1'))[0]
      session.latestModelCall!.status = status
      session.latestModelCall!.error = status === 'failed' ? 'MODEL_FAILED' : null
      await store.save(session)
      scope.stop()
      mountAgent()
      await vi.waitFor(() => expect(agent.ready.value).toBe(true))
      expect(agent.selectSession(session.id)).toBe(true)
      expect(agent.latestModelCall.value).toEqual({
        ...session.latestModelCall,
        status: status === 'running' ? 'cancelled' : 'failed',
      })
      expect(agent.busy.value).toBe(false)
      expect(agent.currentMessages.value).toHaveLength(2)
      expect(transport.calls).toHaveBeenCalledOnce()
      await agent.send('continue')
      expect(transport.calls.mock.calls[1][0].messages.slice(1)).toEqual([
        { role: 'user', content: userContent('original input') },
        { role: 'assistant', content: [{ type: 'text', text: 'complete reply' }] },
        { role: 'user', content: userContent('continue') },
      ])
    },
  )
  it('preserves complete diagnostic output when saving the completed session fails', async () => {
    const original = AgentSessionStore.prototype.save
    let failed = false
    const save = vi
      .spyOn(AgentSessionStore.prototype, 'save')
      .mockImplementation(function (session) {
        if (!failed && session.latestModelCall?.status === 'completed') {
          failed = true
          return Promise.reject(new Error('STORAGE_FAILED'))
        }
        return original.call(this, session)
      })
    try {
      await agent.send('hello')
      expect(agent.storageError.value).toBe('STORAGE_FAILED')
      const logs = await indexedDBService.transaction('agentLogs', 'readonly', (store) =>
        store.getAll(),
      )
      const call = logs[0].spans.find((span: { kind: string }) => span.kind === 'model_call')
      expect(call.source.output.message.content).toBe('complete reply')
      expect(call.source.status).toBe('completed')
    } finally {
      save.mockRestore()
    }
  })
  it('restores paired history from one session store and keeps diagnostics in telemetry', async () => {
    transport.calls.mockImplementationOnce(async (request: StreamParams) =>
      output(
        request,
        Promise.resolve({
          modelCallId: request.modelCallId,
          usage: null,
          message: {
            role: 'assistant',
            content: '',
            tool_calls: [{ id: 'read', name: 'read_project_info', args: {} }],
          },
        }),
      ),
    )
    await agent.send('读取工程')
    const id = agent.currentSessionId.value
    expect(agent.toolExecutions.value).toEqual({})
    const saved = await new AgentSessionStore().load('u1', 'p1')
    expect(saved[0].messages.map((message) => message.role)).toEqual([
      'user',
      'assistant',
      'tool',
      'assistant',
    ])
    expect(saved[0].latestModelCall).toEqual({
      id: transport.calls.mock.calls[1][0].modelCallId,
      status: 'completed',
      inputMessageId: saved[0].messages[2].id,
      assistantMessageId: saved[0].messages[3].id,
      error: null,
    })
    expect(saved[0].toolExecutions).toEqual({})
    const db = await indexedDBService.openDB()
    expect(db.objectStoreNames.contains('agentModelCalls')).toBe(false)
    expect(db.objectStoreNames.contains('agentTools')).toBe(false)
    const logs = await indexedDBService.transaction('agentLogs', 'readonly', (store) =>
      store.getAll(),
    )
    const spans = logs[0].spans
    const modelCalls = spans.filter((span: { kind: string }) => span.kind === 'model_call')
    expect(modelCalls).toHaveLength(2)
    expect(modelCalls[1].source.input.messages).toEqual(transport.calls.mock.calls[1][0].messages)
    expect(modelCalls[1].source.output.message.content).toBe('complete reply')
    expect(spans).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'tool_result',
          source: expect.objectContaining({
            status: 'completed',
            output: expect.objectContaining({ content: 'original tool output' }),
          }),
        }),
      ]),
    )
    scope.stop()
    mountAgent()
    await vi.waitFor(() => expect(agent.ready.value).toBe(true))
    expect(agent.currentMessages.value).toEqual([])
    expect(agent.selectSession(id)).toBe(true)
    expect(agent.currentMessages.value).toHaveLength(3)
    await agent.send('继续读取后的聊天')
    expect(
      transport.calls.mock.calls[2][0].messages
        .slice(1)
        .map((message: { role: string }) => message.role),
    ).toEqual(['user', 'assistant', 'tool', 'assistant', 'user'])
    await agent.deleteSession(id)
    expect(await new AgentSessionStore().load('u1', 'p1')).toEqual([])
    expect(
      await indexedDBService.transaction('agentLogs', 'readonly', (store) => store.getAll()),
    ).toEqual([])
  })

  it.each(['option', 'custom_input'] as const)(
    'restores an unanswered question without running and resumes via %s',
    async (via) => {
      transport.calls.mockImplementationOnce(async (request: StreamParams) =>
        output(
          request,
          Promise.resolve({
            modelCallId: request.modelCallId,
            usage: null,
            message: {
              role: 'assistant',
              content: '',
              tool_calls: [
                {
                  id: 'ask',
                  name: 'ask_user',
                  args: { question: '画幅？', suggested_options: ['横屏', '竖屏'] },
                },
              ],
            },
          }),
        ),
      )
      await agent.send('提问')
      const id = agent.currentSessionId.value
      scope.stop()
      mountAgent()
      await vi.waitFor(() => expect(agent.ready.value).toBe(true))
      agent.selectSession(id)
      expect(agent.busy.value).toBe(false)
      expect(agent.pendingInteraction.value).toMatchObject({
        prompt: '画幅？',
        options: ['横屏', '竖屏'],
      })
      expect(transport.calls).toHaveBeenCalledOnce()
      expect(await agent.send('问题未回答不能发新指令')).toBe(false)
      const answer = agent.answerQuestion('横屏', via)
      expect(await agent.answerQuestion('重复', via)).toBe(false)
      await answer
      const history = transport.calls.mock.calls[1][0].messages.slice(1)
      expect(history.map((message: { role: string }) => message.role)).toEqual([
        'user',
        'assistant',
        'tool',
      ])
      expect(history[2].content).toEqual([{ type: 'text', text: '[ASK_RESULT]\n横屏' }])
      expect(agent.currentMessages.value[1].interaction?.result?.submitted_via).toBe(via)
      expect(agent.toolExecutions.value).toEqual({})
    },
  )

  it('keeps A tool results in A while viewing B and reuses the same connection', async () => {
    transport.calls.mockImplementationOnce(async (request: StreamParams) =>
      output(
        request,
        Promise.resolve({
          modelCallId: request.modelCallId,
          usage: null,
          message: {
            role: 'assistant',
            content: '查询',
            tool_calls: [{ id: 'tool-a', name: 'read_project_info', args: {} }],
          },
        }),
      ),
    )
    let finish!: (value: { success: boolean; output: string }) => void
    toolExecution.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve
        }),
    )
    const idA = agent.currentSessionId.value
    const run = agent.send('A 输入')
    await vi.waitFor(() => expect(toolExecution).toHaveBeenCalledOnce())
    // 同账户对象替换（例如模型扣费后的余额刷新）不应重新加载历史或替换正在运行的 session。
    user.currentUser.value = { id: 'u1', balance: '-0.01' }
    expect(agent.historyLoading.value).toBe(false)
    expect(agent.busy.value).toBe(true)
    agent.newChat()
    const idB = agent.currentSessionId.value
    expect(await agent.send('B 被阻止')).toBe(false)
    expect(toolExecution.mock.calls[0][2].isCurrent()).toBe(true)
    finish({ success: true, output: 'A 的结果' })
    await run
    expect(agent.currentMessages.value).toEqual([])
    agent.selectSession(idA)
    expect(agent.currentMessages.value).toHaveLength(3)
    expect(agent.toolExecutions.value).toEqual({})
    const a = (await new AgentSessionStore().load('u1', 'p1')).find(
      (session) => session.id === idA,
    )!
    expect(a.messages[2]).toMatchObject({ role: 'tool', toolCallId: 'tool-a' })
    agent.selectSession(idB)
    await agent.send('B 输入')
    expect(transport.calls.mock.calls[2][0].messages.slice(1)).toEqual([
      { role: 'user', content: userContent('B 输入') },
    ])
    expect(transport.close).not.toHaveBeenCalled()
    expect(transport.created).toHaveBeenCalledOnce()
  })

  it('releases A at ask_user, permits B, and prevents A answers until B is idle', async () => {
    transport.calls.mockImplementationOnce(async (request: StreamParams) =>
      output(
        request,
        Promise.resolve({
          modelCallId: request.modelCallId,
          usage: null,
          message: {
            role: 'assistant',
            content: '',
            tool_calls: [
              {
                id: 'ask-a',
                name: 'ask_user',
                args: { question: '继续？', suggested_options: ['好'] },
              },
            ],
          },
        }),
      ),
    )
    await agent.send('A 提问')
    const idA = agent.currentSessionId.value
    agent.newChat()
    let finish!: (value: Completion) => void
    transport.calls.mockImplementationOnce(async (request: StreamParams) =>
      output(
        request,
        new Promise((resolve) => {
          finish = resolve
        }),
      ),
    )
    const b = agent.send('B 执行')
    await vi.waitFor(() => expect(transport.calls).toHaveBeenCalledTimes(2))
    const modelCallId = agent.latestModelCall.value!.id
    agent.selectSession(idA)
    expect(agent.running.value).toBe(false)
    expect(agent.pendingInteraction.value).not.toBeNull()
    expect(await agent.answerQuestion('好')).toBe(false)
    expect(agent.toolExecutions.value).not.toEqual({})
    finish({ modelCallId, message: { role: 'assistant', content: 'B 完成' }, usage: null })
    await b
    expect(await agent.answerQuestion('好')).toBe(true)
  })

  it('isolates users, projects and tool contracts without creating legacy storage', async () => {
    await agent.send('u1 p1 历史')
    const id = agent.currentSessionId.value
    const store = new AgentSessionStore()
    expect(await store.load('u2', 'p1')).toEqual([])
    expect(await store.load('u1', 'p2')).toEqual([])
    const db = await indexedDBService.openDB()
    expect(db.objectStoreNames.contains('sessions')).toBe(false)
    const tx = db.transaction('agentSessions', 'readwrite')
    tx.objectStore('agentSessions').put({
      key: 'old-contract',
      sessionKey: 'old-contract',
      owner: JSON.stringify(['u1', 'p1', 'editor-tools-v0']),
      data: { id: 'old' },
    })
    await new Promise<void>((resolve) => {
      tx.oncomplete = () => resolve()
    })
    scope.stop()
    mountAgent()
    await vi.waitFor(() => expect(agent.ready.value).toBe(true))
    expect(agent.sessionHistory.value.map((session) => session.id)).toEqual([id])
    user.currentUser.value = { id: 'u2', balance: '0' }
    await vi.waitFor(() => expect(agent.ready.value).toBe(true))
    expect(agent.sessionHistory.value).toEqual([])
    user.currentUser.value = { id: 'u1', balance: '0' }
    await vi.waitFor(() => expect(agent.ready.value).toBe(true))
    expect(agent.selectSession(id)).toBe(true)
    expect(agent.currentMessages.value).toHaveLength(2)
  })
})

describe('text Agent orchestration', () => {
  it('stores a full background snapshot and sends it as a part of the same user message', async () => {
    const root: VirtualDirectory = {
      id: 'dir_root',
      name: 'Root',
      type: 'base',
      parentId: null,
      createdAt: '2026-10-12T00:00:00Z',
      childDirIds: ['dir_video'],
    }
    const folder: VirtualDirectory = {
      id: 'dir_video',
      name: 'Videos',
      type: 'base',
      parentId: 'dir_root',
      createdAt: root.createdAt,
      childDirIds: [],
    }
    directories.value.set(root.id, root)
    directories.value.set(folder.id, folder)
    currentDirectory.value = folder
    selection.selectedLibraryAssetIds.value = new Set(['dir_video', 'media1', 'missing'])
    currentFrame.value = 315
    viewport.zoomLevel.value = 2
    viewport.scrollOffset.value = 400

    await agent.send(' move selected clip ')
    const request = transport.calls.mock.calls[0][0] as StreamParams
    const part = agent.currentMessages.value[0].parts[1]
    expect(part.type).toBe(MessagePartType.BACKGROUND_CONTEXT)
    if (part.type !== MessagePartType.BACKGROUND_CONTEXT) throw new Error('Missing snapshot')
    expect(JSON.parse(part.text)).toEqual({
      captured_at: expect.any(String),
      project_id: 'p1',
      project_name: 'Test',
      fps: 30,
      current_library_directory: { dir_id: 'dir_video', path: '/Videos/' },
      selected_library_items: [
        {
          type: 'directory',
          id: 'dir_video',
          name: 'Videos',
          parent_dir_id: 'dir_root',
          parent_path: '/',
          path: '/Videos/',
        },
        {
          type: 'media',
          id: 'media1',
          name: 'Video',
          parent_dir_id: 'dir_video',
          parent_path: '/Videos/',
        },
        { type: 'unknown', id: 'missing', name: null, parent_dir_id: null, parent_path: null },
      ],
      selected_clip_ids: ['clip1'],
      playhead_time: '00:00:10+15',
      visible_time_range: { start: '00:00:15+00', end: '00:00:45+00' },
    })
    expect(request.messages).toEqual([
      { role: 'system', content: systemPrompt },
      {
        role: 'user',
        content: [
          {
            type: 'text',
            text: `[BACKGROUND_CONTEXT]\n用户发送时的工程上下文快照：\n${part.text}`,
          },
          { type: 'text', text: 'move selected clip' },
        ],
      },
    ])
    expect(agent.sessionHistory.value[0].preview).toBe('move selected clip')
  })

  it('keeps per-input snapshots unchanged across state changes and a session reload', async () => {
    await agent.send('first')
    const first = structuredClone((transport.calls.mock.calls[0][0] as StreamParams).messages[1])
    const sessionId = agent.currentSessionId.value
    config.projectName.value = 'Renamed'
    selection.selectedClipTimelineItemIds.value = ['clip2']
    selection.selectedLibraryAssetIds.value.clear()
    currentFrame.value = 60
    await agent.send('second')
    const secondRequest = transport.calls.mock.calls[1][0] as StreamParams
    expect(secondRequest.messages[1]).toEqual(first)
    expect(secondRequest.messages[0]).toEqual({ role: 'system', content: systemPrompt })
    const saved = await new AgentSessionStore().load('u1', 'p1')
    const part = saved.find((session) => session.id === sessionId)!.messages[2].parts[1]
    if (part.type !== MessagePartType.BACKGROUND_CONTEXT) throw new Error('Missing snapshot')
    expect(JSON.parse(part.text)).toMatchObject({
      project_name: 'Renamed',
      selected_clip_ids: ['clip2'],
      selected_library_items: [],
      playhead_time: '00:00:02+00',
    })
    const second = structuredClone(secondRequest.messages[3])
    scope.stop()
    selection.selectedClipTimelineItemIds.value = []
    mountAgent()
    await vi.waitFor(() => expect(agent.ready.value).toBe(true))
    agent.selectSession(sessionId)
    await agent.send('third')
    const thirdRequest = transport.calls.mock.calls[2][0] as StreamParams
    expect(thirdRequest.messages[1]).toEqual(first)
    expect(thirdRequest.messages[3]).toEqual(second)
    expect(thirdRequest.messages[5].content).toEqual([
      { type: 'text', text: expect.stringContaining('"selected_clip_ids":[]') },
      { type: 'text', text: 'third' },
    ])
  })

  it('continues legacy history without fabricating background snapshots', async () => {
    await agent.send('legacy input')
    const sessionId = agent.currentSessionId.value
    const store = new AgentSessionStore()
    const saved = (await store.load('u1', 'p1')).find((session) => session.id === sessionId)!
    saved.messages[0].parts = [{ type: MessagePartType.TEXT, text: 'legacy input' }]
    await store.save(saved)
    scope.stop()
    mountAgent()
    await vi.waitFor(() => expect(agent.ready.value).toBe(true))
    agent.selectSession(sessionId)
    await agent.send('new input')
    const request = transport.calls.mock.calls[1][0] as StreamParams
    expect(request.messages[1]).toEqual({
      role: 'user',
      content: [{ type: 'text', text: 'legacy input' }],
    })
    expect(request.messages[3].content).toEqual(userContent('new input'))
    expect(agent.currentMessages.value[0].parts).toEqual([{ type: 'text', text: 'legacy input' }])
  })

  it('marks unavailable directory paths and invalid timeline positions as null', async () => {
    const folder: VirtualDirectory = {
      id: 'dir_broken',
      name: 'Broken',
      type: 'base',
      parentId: 'dir_broken',
      createdAt: '2026-10-12T00:00:00Z',
      childDirIds: [],
    }
    directories.value.set(folder.id, folder)
    currentDirectory.value = folder
    currentFrame.value = NaN
    viewport.TimelineContentWidth.value = 0
    await agent.send('hello')
    const part = agent.currentMessages.value[0].parts[1]
    if (part.type !== MessagePartType.BACKGROUND_CONTEXT) throw new Error('Missing snapshot')
    expect(JSON.parse(part.text)).toMatchObject({
      current_library_directory: { dir_id: 'dir_broken', path: null },
      playhead_time: null,
      visible_time_range: null,
    })
  })

  it('preserves separate text parts and snapshots without sending UI parts or metadata', async () => {
    await agent.send('first')
    // 构造多文本部件的历史，验证请求映射保留分段而非依赖当前流式回复只有一个 TEXT 部件。
    const parts = toRaw(agent.currentMessages.value[1].parts) as AgentMessagePart[]
    parts.splice(
      0,
      parts.length,
      { type: MessagePartType.TEXT, text: '第一段 ' },
      { type: MessagePartType.TEXT, text: '\n' },
      { type: MessagePartType.TEXT, text: '第二段' },
      { type: MessagePartType.IMAGE, url: 'https://example.com/ui-only.png' },
      { type: MessagePartType.BACKGROUND_CONTEXT, text: '界面上下文' },
    )
    await agent.send('second')
    const history = (transport.calls.mock.calls[1][0] as StreamParams).messages
    expect(history[2]).toEqual({
      role: 'assistant',
      content: [
        { type: 'text', text: '第一段 ' },
        { type: 'text', text: '\n' },
        { type: 'text', text: '第二段' },
      ],
    })
    const first = parts[0]
    if (first.type === MessagePartType.TEXT) first.text = '随后修改'
    expect(history[2].content).toEqual([
      { type: 'text', text: '第一段 ' },
      { type: 'text', text: '\n' },
      { type: 'text', text: '第二段' },
    ])
  })
  it('executes successive tools with fresh modelCall IDs and preserves opaque results in paired history', async () => {
    const replies: Completion['message'][] = [
      {
        role: 'assistant',
        content: '',
        tool_calls: [{ id: 'call1', name: 'read_project_info', args: {} }],
      },
      {
        role: 'assistant',
        content: '读取后编辑',
        tool_calls: [{ id: 'call2', name: 'add_track', args: { trackType: 'text' } }],
      },
      { role: 'assistant', content: 'done' },
    ]
    transport.calls.mockImplementation(async (request: StreamParams) =>
      output(
        request,
        Promise.resolve({
          modelCallId: request.modelCallId,
          message: replies.shift()!,
          usage: null,
        }),
      ),
    )
    toolExecution.mockImplementation(async () => {
      selection.selectedClipTimelineItemIds.value = ['changed-during-tool']
      currentFrame.value = 90
      expect(agent.running.value).toBe(true)
      expect(await agent.send('concurrent')).toBe(false)
      // 自动续轮时只保留当前执行，上一次工具结果已进入消息历史并清理执行记录。
      const assistantId = agent.latestModelCall.value!.assistantMessageId
      expect(Object.keys(agent.toolExecutions.value)).toEqual([assistantId])
      expect(agent.toolExecutions.value[assistantId]).toMatchObject({
        assistantMessageId: assistantId,
        status: 'pending',
        result: null,
      })
      return { success: true, output: '[KEYFRAMES]\n...省略，并非 JSON' }
    })
    await agent.send('read and edit')
    expect(toolExecution).toHaveBeenCalledTimes(2)
    const calls = transport.calls.mock.calls.map((call) => call[0] as StreamParams)
    expect(calls[1].messages.slice(0, 2)).toEqual(calls[0].messages)
    expect(calls[2].messages.slice(0, 2)).toEqual(calls[0].messages)
    expect(new Set(calls.map((call) => call.modelCallId)).size).toBe(3)
    expect(calls[0].tools).toHaveLength(30)
    expect(calls[2].messages.slice(1).map((message) => message.role)).toEqual([
      'user',
      'assistant',
      'tool',
      'assistant',
      'tool',
    ])
    expect(calls[1].messages.at(-1)).toEqual({
      role: 'tool',
      tool_call_id: 'call1',
      name: 'read_project_info',
      content: [{ type: 'text', text: '[KEYFRAMES]\n...省略，并非 JSON' }],
    })
    expect(agent.toolExecutions.value).toEqual({})
    for (const message of agent.currentMessages.value.slice(1, 3)) {
      expect(message.parts).toContainEqual(
        expect.objectContaining({ type: 'tool_call', status: 'completed' }),
      )
    }
    expect(agent.currentMessages.value.map((message) => message.role)).toEqual([
      'user',
      'assistant',
      'assistant',
      'assistant',
    ])
    expect(toolExecution.mock.calls[0][2]).toMatchObject({
      userId: 'u1',
      projectId: 'p1',
      sessionId: agent.currentSessionId.value,
      modelCallId: calls[0].modelCallId,
      toolCallId: 'call1',
    })
    expect(agent.running.value).toBe(false)
  })
  it.each([true, false])(
    'inserts the tool result immediately after its assistant despite later messages (success: %s)',
    async (success) => {
      await agent.send('之前的请求')
      const assistantId = agent.currentMessages.value[1].id
      transport.calls.mockImplementationOnce(async (request: StreamParams) =>
        output(
          request,
          Promise.resolve({
            modelCallId: request.modelCallId,
            usage: null,
            message: {
              role: 'assistant',
              content: '正在读取',
              tool_calls: [{ id: 'older-call', name: 'read_project_info', args: {} }],
            },
          }),
        ),
      )
      toolExecution.mockImplementationOnce(async () => {
        // 构造提交目标后面已有消息的情况，验证配对位置不依赖助手消息位于列表末尾。
        const records = toRaw(agent.toolExecutions.value) as Record<
          string,
          { assistantMessageId: string }
        >
        const currentAssistantId = agent.latestModelCall.value!.assistantMessageId
        const execution = records[currentAssistantId]
        delete records[currentAssistantId]
        execution.assistantMessageId = assistantId
        records[assistantId] = execution
        return { success, output: success ? '读取成功' : '读取失败' }
      })
      await agent.send('读取工程')
      const history = (transport.calls.mock.calls[2][0] as StreamParams).messages.slice(1)
      expect(history).toEqual([
        { role: 'user', content: userContent('之前的请求') },
        {
          role: 'assistant',
          content: [{ type: 'text', text: 'complete reply' }],
          tool_calls: [{ id: 'older-call', name: 'read_project_info', args: {} }],
        },
        {
          role: 'tool',
          content: [{ type: 'text', text: success ? '读取成功' : '读取失败' }],
          tool_call_id: 'older-call',
          name: 'read_project_info',
        },
        { role: 'user', content: userContent('读取工程') },
        { role: 'assistant', content: [{ type: 'text', text: '正在读取' }] },
      ])
      expect(agent.currentMessages.value[1].id).toBe(assistantId)
      expect(agent.toolExecutions.value).toEqual({})
      expect(agent.currentMessages.value[1].parts).toContainEqual(
        expect.objectContaining({
          tool_call_id: 'older-call',
          status: success ? 'completed' : 'failed',
        }),
      )
      expect(toolExecution).toHaveBeenCalledOnce()
    },
  )
  it.each([
    { via: 'option', stopBeforeAnswer: false },
    { via: 'custom_input', stopBeforeAnswer: false },
    { via: 'option', stopBeforeAnswer: true },
    { via: 'custom_input', stopBeforeAnswer: true },
  ] as const)(
    'resumes with one paired ASK_RESULT via $via (stopped: $stopBeforeAnswer)',
    async ({ via, stopBeforeAnswer }) => {
      transport.calls.mockImplementationOnce(async (request: StreamParams) =>
        output(
          request,
          Promise.resolve({
            modelCallId: request.modelCallId,
            usage: null,
            message: {
              role: 'assistant',
              content: '',
              tool_calls: [
                {
                  id: 'ask1',
                  name: 'ask_user',
                  args: { question: '哪种比例？', suggested_options: ['横屏', '竖屏'] },
                },
              ],
            },
          }),
        ),
      )
      await agent.send('edit')
      expect(agent.running.value).toBe(false)
      expect(agent.pendingInteraction.value).toMatchObject({
        interaction_id: 'ask1',
        prompt: '哪种比例？',
        options: ['横屏', '竖屏'],
      })
      expect(toolExecution).not.toHaveBeenCalled()
      expect(agent.currentMessages.value[1].parts.some((part) => part.type === 'tool_call')).toBe(
        false,
      )
      if (stopBeforeAnswer) {
        agent.stop()
        expect(agent.pendingInteraction.value?.interaction_id).toBe('ask1')
        expect(agent.currentMessages.value[1].interaction?.result).toBeNull()
        expect(agent.running.value).toBe(false)
      }
      // 等待工具回答时，新消息入口不能新增消息、代交回答或触发模型调用。
      expect(await agent.send('横屏')).toBe(false)
      expect(agent.currentMessages.value).toHaveLength(2)
      expect(agent.pendingInteraction.value?.interaction_id).toBe('ask1')
      expect(agent.toolExecutions.value[agent.currentMessages.value[1].id].result).toBeNull()
      expect(Object.keys(agent.toolExecutions.value)).toEqual([agent.currentMessages.value[1].id])
      expect(transport.calls).toHaveBeenCalledTimes(1)
      selection.selectedClipTimelineItemIds.value = ['changed-while-answering']
      currentFrame.value = 120
      const resumed = agent.answerQuestion('竖屏', via)
      expect(agent.running.value).toBe(true)
      expect(agent.toolExecutions.value).toEqual({})
      expect(await agent.answerQuestion('横屏', 'option')).toBe(false)
      await resumed
      expect(agent.pendingInteraction.value).toBeNull()
      expect(agent.currentMessages.value[1].interaction?.result).toMatchObject({
        answer: '竖屏',
        submitted_via: via,
      })
      expect(agent.currentMessages.value[1].parts.some((part) => part.type === 'tool_call')).toBe(
        false,
      )
      const request = transport.calls.mock.calls[1][0] as StreamParams
      expect(request.messages.slice(0, 2)).toEqual(transport.calls.mock.calls[0][0].messages)
      expect(request.messages.slice(1).map((message) => message.role)).toEqual([
        'user',
        'assistant',
        'tool',
      ])
      expect(request.messages[2]).toMatchObject({
        role: 'assistant',
        tool_calls: [
          {
            id: 'ask1',
            name: 'ask_user',
            args: { question: '哪种比例？', suggested_options: ['横屏', '竖屏'] },
          },
        ],
      })
      expect(request.messages.at(-1)).toEqual({
        role: 'tool',
        name: 'ask_user',
        tool_call_id: 'ask1',
        content: [{ type: 'text', text: '[ASK_RESULT]\n竖屏' }],
      })
      expect(agent.toolExecutions.value).toEqual({})
    },
  )
  it.each(['', '原工具错误输出'])(
    'returns tool failure to the model for correction (output: %s)',
    async (failureOutput) => {
      const error = 'apply.canvas 只能传 presetKey，或同时传 width 和 height。'
      const match = {
        canvas: { height: 1080, presetKey: 'landscape_1080p', width: 1920 },
        description: '',
        name: '新项目 2026/9/23',
      }
      const apply = { ...match, name: '工具测试工程', description: '工具测试专用工程' }
      const replies: Completion['message'][] = [
        {
          role: 'assistant',
          content: '',
          tool_calls: [{ id: 'bad-canvas', name: 'modify_project_info', args: { match, apply } }],
        },
        {
          role: 'assistant',
          content: '',
          tool_calls: [
            {
              id: 'fixed-canvas',
              name: 'modify_project_info',
              args: { match, apply: { ...apply, canvas: { presetKey: 'landscape_1080p' } } },
            },
          ],
        },
        { role: 'assistant', content: '修改完成' },
      ]
      transport.calls.mockImplementation(async (request: StreamParams) =>
        output(
          request,
          Promise.resolve({
            modelCallId: request.modelCallId,
            message: replies.shift()!,
            usage: null,
          }),
        ),
      )
      toolExecution
        .mockResolvedValueOnce({ success: false, output: failureOutput, error })
        .mockResolvedValueOnce({ success: true, output: '工程已修改' })
      await agent.send('修改工程')
      expect(toolExecution).toHaveBeenCalledTimes(2)
      const calls = transport.calls.mock.calls.map(([request]) => request as StreamParams)
      expect(new Set(calls.map((request) => request.modelCallId)).size).toBe(3)
      expect(calls[1].messages.at(-1)).toEqual({
        role: 'tool',
        tool_call_id: 'bad-canvas',
        name: 'modify_project_info',
        content: [{ type: 'text', text: failureOutput || error }],
      })
      expect(calls[2].messages.at(-1)).toMatchObject({
        tool_call_id: 'fixed-canvas',
        content: [{ type: 'text', text: '工程已修改' }],
      })
      expect(agent.toolExecutions.value).toEqual({})
      expect(agent.currentMessages.value[1].parts[1]).toMatchObject({ status: 'failed' })
      expect(agent.latestModelCall.value).toMatchObject({ status: 'completed', error: null })
      expect(agent.running.value).toBe(false)
    },
  )
  it('pairs schema validation errors and lets the model correct an ask_user call', async () => {
    const replies: Completion['message'][] = [
      {
        role: 'assistant',
        content: '',
        tool_calls: [{ id: 'bad-ask', name: 'ask_user', args: { question: '片名？' } }],
      },
      {
        role: 'assistant',
        content: '',
        tool_calls: [
          {
            id: 'fixed-ask',
            name: 'ask_user',
            args: { question: '片名？', suggested_options: [] },
          },
        ],
      },
    ]
    transport.calls.mockImplementation(async (request: StreamParams) =>
      output(
        request,
        Promise.resolve({
          modelCallId: request.modelCallId,
          message: replies.shift()!,
          usage: null,
        }),
      ),
    )
    await agent.send('确定片名')
    expect(toolExecution).not.toHaveBeenCalled()
    expect(transport.calls).toHaveBeenCalledTimes(2)
    expect(transport.calls.mock.calls[1][0].messages.at(-1)).toMatchObject({
      role: 'tool',
      tool_call_id: 'bad-ask',
      name: 'ask_user',
      content: [
        {
          type: 'text',
          text: expect.stringContaining("must have required property 'suggested_options'"),
        },
      ],
    })
    const questionMessageId = agent.currentMessages.value[2].id
    expect(Object.keys(agent.toolExecutions.value)).toEqual([questionMessageId])
    expect(agent.toolExecutions.value[questionMessageId]).toMatchObject({
      status: 'pending',
      result: null,
      call: { id: 'fixed-ask', name: 'ask_user' },
    })
    expect(agent.currentMessages.value[1].parts).toContainEqual(
      expect.objectContaining({ type: 'tool_call', tool_call_id: 'bad-ask', status: 'failed' }),
    )
    expect(agent.pendingInteraction.value).toMatchObject({
      interaction_id: 'fixed-ask',
      options: [],
    })
    expect(agent.running.value).toBe(false)
  })
  it('returns thrown tool errors as paired results and continues to the final reply', async () => {
    transport.calls.mockImplementationOnce(async (request: StreamParams) =>
      output(
        request,
        Promise.resolve({
          modelCallId: request.modelCallId,
          usage: null,
          message: {
            role: 'assistant',
            content: '',
            tool_calls: [{ id: 'throws', name: 'read_project_info', args: {} }],
          },
        }),
      ),
    )
    toolExecution.mockRejectedValueOnce(new Error('工具读取失败'))
    await agent.send('读取工程')
    expect(transport.calls).toHaveBeenCalledTimes(2)
    expect(transport.calls.mock.calls[1][0].messages.at(-1)).toEqual({
      role: 'tool',
      name: 'read_project_info',
      tool_call_id: 'throws',
      content: [{ type: 'text', text: '工具读取失败' }],
    })
    expect(agent.toolExecutions.value).toEqual({})
    expect(agent.currentMessages.value[1].parts).toContainEqual(
      expect.objectContaining({ type: 'tool_call', tool_call_id: 'throws', status: 'failed' }),
    )
    expect(agent.latestModelCall.value?.status).toBe('completed')
  })
  it('saves the tool error after stopping without continuing the model loop', async () => {
    transport.calls.mockImplementationOnce(async (request: StreamParams) =>
      output(
        request,
        Promise.resolve({
          modelCallId: request.modelCallId,
          usage: null,
          message: {
            role: 'assistant',
            content: '',
            tool_calls: [{ id: 'stopped', name: 'read_project_info', args: {} }],
          },
        }),
      ),
    )
    toolExecution.mockImplementationOnce(async () => {
      agent.stop()
      throw new Error('工具已取消')
    })
    await agent.send('读取工程')
    expect(transport.calls).toHaveBeenCalledTimes(1)
    expect(agent.toolExecutions.value).toEqual({})
    expect(agent.currentMessages.value[1].parts).toContainEqual(
      expect.objectContaining({
        type: 'tool_call',
        status: 'failed',
        tool_call_id: 'stopped',
      }),
    )
    expect(agent.running.value).toBe(false)
    await agent.send('继续')
    expect((transport.calls.mock.calls[1][0] as StreamParams).messages[3]).toEqual({
      role: 'tool',
      name: 'read_project_info',
      tool_call_id: 'stopped',
      content: [{ type: 'text', text: '工具已取消' }],
    })
  })
  it('shares full original schemas and rejects type coercion before executing', () => {
    const runtime = createToolRuntime()
    expect(agentTools).toHaveLength(30)
    expect(agentTools.some((tool) => tool.name === 'inspect_timeline_frames')).toBe(false)
    expect(() =>
      runtime.validate({
        id: '1',
        name: 'rename_library_item',
        args: { item: '{"type":"directory"}', name: 'x', match: { name: 'a', parentPath: '/' } },
      }),
    ).toThrow('TOOL_ARGUMENTS_INVALID')
    expect(() =>
      runtime.validate({
        id: '2',
        name: 'read_tracks',
        args: { trackIds: ['a'], start: '00:00:00+00' },
      }),
    ).not.toThrow()
    expect(() =>
      runtime.validate({ id: '3', name: 'add_track', args: { trackType: 'text', position: '0' } }),
    ).toThrow('TOOL_ARGUMENTS_INVALID')
    expect(toolExecution).not.toHaveBeenCalled()
  })
  it.each([
    { name: 'read_media', outcome: 'success' },
    { name: 'read_media', outcome: 'error' },
    { name: 'search_media', outcome: 'success' },
    { name: 'search_media', outcome: 'error' },
  ])('cancels $name on Agent stop and discards its late $outcome', async ({ name, outcome }) => {
    transport.calls.mockImplementationOnce(async (request: StreamParams) =>
      output(
        request,
        Promise.resolve({
          modelCallId: request.modelCallId,
          usage: null,
          message: {
            role: 'assistant',
            content: '正在查找素材',
            tool_calls: [
              {
                id: 'cancelled-media',
                name,
                args: name === 'read_media' ? { mediaIds: ['m1'] } : { query: 'city' },
              },
            ],
          },
        }),
      ),
    )
    let finish!: () => void
    toolExecution.mockImplementationOnce(
      () =>
        new Promise((resolve, reject) => {
          finish = () => {
            if (outcome === 'error') reject(new Error('迟到的工具错误'))
            else resolve({ success: true, output: '迟到的工具结果' })
          }
        }),
    )
    const id = agent.currentSessionId.value
    const pending = agent.send('查找素材')
    await vi.waitFor(() => expect(toolExecution).toHaveBeenCalledOnce())
    const context = toolExecution.mock.calls[0][2]

    agent.newChat()
    agent.stop()
    expect(context.signal.aborted).toBe(false)
    agent.selectSession(id)
    agent.stop()
    agent.stop()
    expect(context.signal.aborted).toBe(true)
    expect(context.isCurrent()).toBe(false)
    expect(agent.running.value).toBe(true)
    expect(await agent.send('不能并发')).toBe(false)
    finish()
    await pending

    expect(transport.calls).toHaveBeenCalledOnce()
    expect(agent.running.value).toBe(false)
    expect(agent.toolExecutions.value).toEqual({})
    expect(agent.currentMessages.value.map((message) => message.role)).toEqual([
      'user',
      'assistant',
    ])
    expect(agent.currentMessages.value[1].parts).toEqual([{ type: 'text', text: '正在查找素材' }])
    const logs = await indexedDBService.transaction('agentLogs', 'readonly', (store) =>
      store.getAll(),
    )
    expect(logs[0].spans).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'tool_result',
          source: expect.objectContaining({
            status: 'cancelled',
            error: { code: 'TOOL_CANCELLED', result_committed: false },
          }),
        }),
      ]),
    )

    scope.stop()
    mountAgent()
    await vi.waitFor(() => expect(agent.ready.value).toBe(true))
    expect(agent.selectSession(id)).toBe(true)
    expect(agent.toolExecutions.value).toEqual({})
    await agent.send('继续')
    const history = (transport.calls.mock.calls[1][0] as StreamParams).messages.slice(1)
    expect(history.map((message) => message.role)).toEqual(['user', 'assistant', 'user'])
    expect(toolExecution).toHaveBeenCalledOnce()
  })
  it('clears a stopped media call even when stopping during its pending save', async () => {
    transport.calls.mockImplementationOnce(async (request: StreamParams) =>
      output(
        request,
        Promise.resolve({
          modelCallId: request.modelCallId,
          usage: null,
          message: {
            role: 'assistant',
            content: '',
            tool_calls: [{ id: 'before-execute', name: 'read_media', args: { mediaIds: ['m1'] } }],
          },
        }),
      ),
    )
    const original = AgentSessionStore.prototype.save
    const save = vi
      .spyOn(AgentSessionStore.prototype, 'save')
      .mockImplementation(function (session) {
        if (Object.keys(session.toolExecutions).length) agent.stop()
        return original.call(this, session)
      })
    try {
      await agent.send('读取素材')
      expect(toolExecution).not.toHaveBeenCalled()
      expect(agent.running.value).toBe(false)
      expect(agent.toolExecutions.value).toEqual({})
      expect(agent.currentMessages.value).toHaveLength(1)
      const saved = await new AgentSessionStore().load('u1', 'p1')
      expect(saved[0].toolExecutions).toEqual({})
    } finally {
      save.mockRestore()
    }
  })
  it('keeps editing tool progress visible after stopping, commits its result once, and continues only on new input', async () => {
    transport.calls.mockImplementationOnce(async (request: StreamParams) =>
      output(
        request,
        Promise.resolve({
          modelCallId: request.modelCallId,
          usage: null,
          message: {
            role: 'assistant',
            content: '开始编辑',
            tool_calls: [{ id: 'edit', name: 'add_track', args: { trackType: 'text' } }],
          },
        }),
      ),
    )
    let finish!: (value: { success: boolean; output: string }) => void
    toolExecution.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve
        }),
    )
    const pending = agent.send('新增轨道')
    await vi.waitFor(() => expect(toolExecution).toHaveBeenCalledOnce())
    const saved = (await new AgentSessionStore().load('u1', 'p1'))[0]
    expect(saved.toolExecutions).toEqual({})
    expect(saved.messages[1].parts).toEqual([{ type: 'text', text: '开始编辑' }])
    const context = toolExecution.mock.calls[0][2]
    expect(agent.currentMessages.value[1].parts).toContainEqual(
      expect.objectContaining({ type: 'tool_call', status: 'requested' }),
    )
    expect(agent.toolExecutions.value[agent.currentMessages.value[1].id].assistantMessageId).toBe(
      agent.currentMessages.value[1].id,
    )
    agent.stop()
    expect(context.signal.aborted).toBe(false)
    expect(context.isCurrent()).toBe(true)
    expect(agent.running.value).toBe(true)
    // 普通停止还在等待工具真实结果保存，此时也不能删除所属会话。
    expect(await agent.deleteSession(agent.currentSessionId.value)).toBe(false)
    expect(Object.keys(agent.toolExecutions.value)).toEqual([agent.currentMessages.value[1].id])
    expect(await agent.send('不能并发')).toBe(false)
    finish({ success: true, output: '轨道已创建' })
    await pending
    expect(transport.calls).toHaveBeenCalledOnce()
    expect(agent.running.value).toBe(false)
    expect(agent.toolExecutions.value).toEqual({})
    expect(agent.currentMessages.value[1].parts).toContainEqual(
      expect.objectContaining({ status: 'completed' }),
    )
    await agent.send('继续')
    expect(toolExecution).toHaveBeenCalledOnce()
    const history = (transport.calls.mock.calls[1][0] as StreamParams).messages.slice(1)
    expect(history.map((message) => message.role)).toEqual(['user', 'assistant', 'tool', 'user'])
    expect(history[2]).toMatchObject({
      content: [{ type: 'text', text: '轨道已创建' }],
      tool_call_id: 'edit',
    })
  })
  it.each(['project_leave', 'identity_change'] as const)(
    'cancels the old tool and isolates its late result after %s',
    async (change) => {
      transport.calls.mockImplementationOnce(async (request: StreamParams) =>
        output(
          request,
          Promise.resolve({
            modelCallId: request.modelCallId,
            usage: null,
            message: {
              role: 'assistant',
              content: '',
              tool_calls: [{ id: 'old-tool', name: 'read_project_info', args: {} }],
            },
          }),
        ),
      )
      let finish!: (value: { success: boolean; output: string }) => void
      toolExecution.mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            finish = resolve
          }),
      )
      const old = agent.send('旧工程任务')
      await vi.waitFor(() => expect(toolExecution).toHaveBeenCalledOnce())
      const context = toolExecution.mock.calls[0][2]
      if (change === 'project_leave') agent.leaveProject()
      else user.currentUser.value = { id: 'u2', balance: '0' }
      expect(context.signal.aborted).toBe(true)
      expect(context.isCurrent()).toBe(false)
      await vi.waitFor(() => expect(agent.ready.value).toBe(true))
      await agent.send('新任务')
      finish({ success: true, output: '旧结果' })
      await old
      expect(agent.currentMessages.value).toHaveLength(2)
      expect(agent.currentMessages.value[0].parts).toEqual([
        { type: 'text', text: '新任务' },
        { type: 'background_context', text: expect.any(String) },
      ])
      expect(agent.toolExecutions.value).toEqual({})
      expect(agent.running.value).toBe(false)
    },
  )
  it('keeps running while a cancelled model slot is closing and preserves partial text', async () => {
    let release!: () => void
    const idle = new Promise<void>((resolve) => {
      release = resolve
    })
    transport.idle.mockResolvedValueOnce(undefined).mockReturnValueOnce(idle)
    let finish!: (value: Completion) => void
    transport.calls.mockImplementationOnce(async (request: StreamParams) =>
      output(
        request,
        new Promise((resolve) => {
          finish = resolve
        }),
      ),
    )
    const pending = agent.send('第一条')
    await vi.waitFor(() => expect(agent.currentMessages.value).toHaveLength(2))
    agent.stop()
    finish({
      modelCallId: agent.latestModelCall.value!.id,
      usage: null,
      message: { role: 'assistant', content: '停止后的完整结果' },
    })
    await vi.waitFor(() => expect(transport.idle).toHaveBeenCalledTimes(2))
    expect(agent.running.value).toBe(true)
    expect(await agent.send('并发')).toBe(false)
    release()
    await pending
    expect(agent.running.value).toBe(false)
    expect(agent.currentMessages.value[1].parts).toEqual([{ type: 'text', text: 'partial draft' }])
  })
  it('removes an empty assistant placeholder after failure but keeps the user input', async () => {
    transport.calls.mockImplementationOnce(async () => ({
      async *[Symbol.asyncIterator]() {
        yield { delta: '   ' }
      },
      finalCompletion() {
        return Promise.reject(new Error('MODEL_FAILED'))
      },
    }))
    await agent.send('没有回复的输入')
    expect(agent.currentMessages.value).toHaveLength(1)
    await agent.send('继续')
    expect((transport.calls.mock.calls[1][0] as StreamParams).messages.slice(1)).toEqual([
      { role: 'user', content: userContent('没有回复的输入') },
      { role: 'user', content: userContent('继续') },
    ])
  })
  it('creates one client without calling before the project and account are ready', async () => {
    expect(transport.created).toHaveBeenCalledOnce()
    expect(transport.calls).not.toHaveBeenCalled()
    project.isProjectTimelineReady.value = false
    expect(await agent.send('hello')).toBe(false)
    project.isProjectTimelineReady.value = true
    user.currentUser.value = null
    expect(await agent.send('hello')).toBe(false)
    expect(transport.calls).not.toHaveBeenCalled()
  })
  it('carries full committed history and fresh modelCall IDs across successive modelCalls', async () => {
    await agent.send('first')
    await agent.send('second')
    const [first, second] = transport.calls.mock.calls.map((call) => call[0] as StreamParams)
    expect(second.messages.slice(1)).toEqual([
      { role: 'user', content: userContent('first') },
      { role: 'assistant', content: [{ type: 'text', text: 'complete reply' }] },
      { role: 'user', content: userContent('second') },
    ])
    expect(first.messages[0]).toMatchObject({
      role: 'system',
      content: expect.stringContaining('核心规则'),
    })
    expect(first.messages[0].content).toBe(systemPrompt)
    expect(first.messages[1].content).toEqual(userContent('first'))
    expect(second.modelCallId).not.toBe(first.modelCallId)
    expect(first).not.toHaveProperty('taskId')
    expect(second).not.toHaveProperty('taskId')
    expect(agent.latestModelCall.value).toMatchObject({
      id: second.modelCallId,
      status: 'completed',
      error: null,
    })
    expect(agent.latestModelCall.value).not.toHaveProperty('request')
    expect(agent.latestModelCall.value).not.toHaveProperty('completion')
    expect(agent.currentMessages.value).toHaveLength(4)
    expect(agent.currentMessages.value.every((message) => !('status' in message))).toBe(true)
    expect(transport.created).toHaveBeenCalledOnce()
  })
  it('stores increments on one assistant message and calibrates it at completion', async () => {
    let resolve!: (value: Completion) => void
    transport.calls.mockImplementation(async (request: StreamParams) =>
      output(
        request,
        new Promise((done) => {
          resolve = done
        }),
      ),
    )
    const running = agent.send('first')
    expect(agent.running.value).toBe(true)
    expect(await agent.send('second')).toBe(false)
    await vi.waitFor(() =>
      expect(agent.currentMessages.value[1]?.parts[0]).toEqual({
        type: 'text',
        text: 'partial draft',
      }),
    )
    expect(agent.currentMessages.value).toHaveLength(2)
    const assistantId = agent.currentMessages.value[1].id
    const request = transport.calls.mock.calls[0][0] as StreamParams
    resolve({
      modelCallId: request.modelCallId,
      message: { role: 'assistant', content: 'final text' },
      usage: null,
    })
    await running
    expect(agent.currentMessages.value[1]).toMatchObject({
      id: assistantId,
      parts: [{ type: 'text', text: 'final text' }],
    })
    expect(agent.currentMessages.value).toHaveLength(2)
    expect(agent.latestModelCall.value).not.toHaveProperty('draft')
    expect(agent.latestModelCall.value?.status).toBe('completed')
    expect(agent.running.value).toBe(false)
  })
  it.each(['failed', 'cancelled'] as const)(
    'keeps %s input and partial reply in the next request',
    async (status) => {
      await agent.send('completed input')
      let resolve!: (value: Completion) => void
      let reject!: (reason: Error) => void
      transport.calls.mockImplementationOnce(async (request: StreamParams) =>
        output(
          structuredClone(request),
          new Promise((done, fail) => {
            resolve = done
            reject = fail
          }),
        ),
      )
      const pending = agent.send('unfinished input')
      await vi.waitFor(() =>
        expect(agent.currentMessages.value[3]?.parts[0]).toEqual({
          type: 'text',
          text: 'partial draft',
        }),
      )
      const request = transport.calls.mock.calls[1][0] as StreamParams
      if (status === 'cancelled') {
        agent.stop()
        resolve({
          modelCallId: request.modelCallId,
          message: { role: 'assistant', content: 'late reply after stopping' },
          usage: null,
        })
      } else {
        reject(new Error('MODEL_FAILED'))
      }
      await pending
      expect(agent.latestModelCall.value?.status).toBe(status)
      expect(agent.running.value).toBe(false)
      expect(agent.currentMessages.value).toHaveLength(4)
      expect(agent.currentMessages.value[2]).toMatchObject({
        parts: [
          { type: 'text', text: 'unfinished input' },
          { type: 'background_context', text: expect.any(String) },
        ],
      })
      expect(agent.currentMessages.value[3].parts).toEqual([
        { type: 'text', text: 'partial draft' },
      ])

      await agent.send('next input')
      expect(transport.calls.mock.calls[2][0].messages.slice(1)).toEqual([
        { role: 'user', content: userContent('completed input') },
        { role: 'assistant', content: [{ type: 'text', text: 'complete reply' }] },
        { role: 'user', content: userContent('unfinished input') },
        { role: 'assistant', content: [{ type: 'text', text: 'partial draft' }] },
        { role: 'user', content: userContent('next input') },
      ])
    },
  )
  it('new chat clears the temporary history while preserving the shared client', async () => {
    await agent.send('first')
    const sessionId = agent.currentSessionId.value
    agent.newChat()
    expect(agent.currentSessionId.value).not.toBe(sessionId)
    expect(agent.currentMessages.value).toEqual([])
    expect(agent.latestModelCall.value).toBeNull()
    await agent.send('new')
    expect(transport.calls.mock.calls[1][0].messages.slice(1)).toEqual([
      { role: 'user', content: userContent('new') },
    ])
    expect(transport.close).not.toHaveBeenCalled()
    expect(transport.created).toHaveBeenCalledOnce()
  })
  it('keeps A running while viewing B, blocks B, then allows B after A finishes', async () => {
    const completions: Array<(value: Completion) => void> = []
    transport.calls.mockImplementation(async (request: StreamParams) =>
      output(structuredClone(request), new Promise((resolve) => completions.push(resolve))),
    )
    const oldRun = agent.send('old session input')
    const oldSession = agent.currentSessionId.value
    await vi.waitFor(() => expect(completions).toHaveLength(1))
    agent.newChat()
    const newSession = agent.currentSessionId.value
    expect(agent.running.value).toBe(false)
    expect(agent.busy.value).toBe(true)
    expect(agent.activeSessionId.value).toBe(oldSession)
    expect(await agent.send('blocked input')).toBe(false)
    expect(agent.currentMessages.value).toEqual([])
    completions[0]({
      modelCallId: transport.calls.mock.calls[0][0].modelCallId,
      message: { role: 'assistant', content: 'old reply' },
      usage: null,
    })
    await oldRun
    expect(agent.currentMessages.value).toEqual([])
    expect(agent.busy.value).toBe(false)
    agent.selectSession(oldSession)
    expect(agent.currentMessages.value[1].parts).toEqual([{ type: 'text', text: 'old reply' }])
    agent.selectSession(newSession)
    const newRun = agent.send('new session input')
    await vi.waitFor(() => expect(completions).toHaveLength(2))
    const newModelCallId = agent.latestModelCall.value!.id
    expect(agent.running.value).toBe(true)
    expect(agent.latestModelCall.value).toMatchObject({ id: newModelCallId, status: 'running' })
    expect(agent.currentMessages.value[1].parts).toEqual([{ type: 'text', text: 'partial draft' }])
    expect(agent.currentMessages.value[0]).toMatchObject({
      parts: [
        { type: 'text', text: 'new session input' },
        { type: 'background_context', text: expect.any(String) },
      ],
    })
    completions[1]({
      modelCallId: newModelCallId,
      message: { role: 'assistant', content: 'new reply' },
      usage: null,
    })
    await newRun
    expect(agent.running.value).toBe(false)
    expect(agent.latestModelCall.value?.status).toBe('completed')
    expect(agent.currentMessages.value[1]).toMatchObject({
      parts: [{ type: 'text', text: 'new reply' }],
    })
  })
  it('ignores a late completion after clearing the session without another send', async () => {
    let resolve!: (value: Completion) => void
    transport.calls.mockImplementation(async (request: StreamParams) =>
      output(
        request,
        new Promise((done) => {
          resolve = done
        }),
      ),
    )
    const pending = agent.send('old input')
    await vi.waitFor(() =>
      expect(agent.currentMessages.value[1]?.parts[0]).toEqual({
        type: 'text',
        text: 'partial draft',
      }),
    )
    const modelCallId = agent.latestModelCall.value!.id
    agent.leaveProject()
    resolve({ modelCallId, message: { role: 'assistant', content: 'late reply' }, usage: null })
    await pending
    expect(agent.latestModelCall.value).toBeNull()
    expect(agent.currentMessages.value).toEqual([])
    expect(agent.running.value).toBe(false)
  })
  it('preserves history on balance refresh but isolates another account', async () => {
    await agent.send('first')
    user.currentUser.value = { id: 'u1', balance: '-0.01' }
    expect(agent.currentMessages.value).toHaveLength(2)
    expect(transport.close).not.toHaveBeenCalled()
    user.currentUser.value = { id: 'u2', balance: '0' }
    expect(agent.currentMessages.value).toEqual([])
    expect(transport.close).toHaveBeenCalledWith('IDENTITY_CHANGED')
  })
  it('blocks an invalid identity until the account changes', async () => {
    await agent.send('first')
    transport.identity!()
    expect(agent.ready.value).toBe(false)
    expect(agent.currentMessages.value).toEqual([])
    expect(agent.latestModelCall.value).toBeNull()
    expect(transport.close).toHaveBeenCalledWith('IDENTITY_INVALID')
    transport.calls.mockClear()
    user.currentUser.value = { id: 'u1', balance: '-0.01' }
    expect(await agent.send('blocked')).toBe(false)
    expect(transport.calls).not.toHaveBeenCalled()
    user.currentUser.value = { id: 'u2', balance: '0' }
    await vi.waitFor(() => expect(agent.ready.value).toBe(true))
    await agent.send('new account')
    expect(agent.latestModelCall.value).toMatchObject({ status: 'completed' })
    const sessions = await new AgentSessionStore().load('u2', 'p1')
    expect(sessions).toHaveLength(1)
    expect(sessions[0]).toMatchObject({ id: agent.currentSessionId.value, userId: 'u2' })
  })
  it('clears messages on pagehide and releases resources with the store scope', async () => {
    await agent.send('first')
    windowTarget.dispatchEvent(new Event('blur'))
    windowTarget.dispatchEvent(new Event('visibilitychange'))
    expect(agent.currentMessages.value).toHaveLength(2)
    windowTarget.dispatchEvent(new Event('pagehide'))
    expect(agent.currentMessages.value).toEqual([])
    expect(transport.close).toHaveBeenCalledWith('PAGE_LEFT')
    scope.stop()
    expect(transport.dispose).toHaveBeenCalledOnce()
    transport.close.mockClear()
    windowTarget.dispatchEvent(new Event('pagehide'))
    expect(transport.close).not.toHaveBeenCalled()
  })
})
