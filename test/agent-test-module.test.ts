import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { effectScope, ref, type EffectScope } from 'vue'
import { ModuleRegistry } from '../src/core/modules/ModuleRegistry'
import { createUnifiedAgentTestModule } from '../src/core/modules/UnifiedAgentTestModule'

// 导入模块前创建的共享传输替身，每个用例清空调用记录并重新登记监听器。
const transport = vi.hoisted(
  /** 提前创建共享传输模拟，供模块导入时的替身引用。 */ () => ({
    // 模型调用替身，可配置立即完成或保持挂起的结果。
    calls: vi.fn(),
    // 连接关闭记录，用于验证账号切换和页面退出时的原因。
    close: vi.fn(),
    // 客户端销毁记录，用于验证作用域结束时的资源释放。
    dispose: vi.fn(),
    // 当前模块登记的连接状态回调，供用例手动推送状态。
    connection: undefined as undefined | ((state: unknown) => void),
    // 当前模块登记的身份失效回调，供用例模拟会话撤销。
    identity: undefined as undefined | (() => void),
  }),
)
vi.mock(
  '../src/aipanel/agent/transport/AgentClient',
  /** 提供可观察连接订阅与调用行为的客户端替身。 */ () => ({
    AgentClientError: class extends Error {},
    AgentClient: class {
      // 与真实客户端一致的调用入口，所有调用转交共享模拟。
      stream = transport.calls
      /** 保存连接状态监听器，并推送初始未连接状态。 */
      subscribeConnection(listener: (state: unknown) => void) {
        transport.connection = listener
        listener({ status: 'disconnected', closeReason: null, error: null })
        return vi.fn()
      }
      /** 保存身份失效监听器，供测试主动触发。 */
      subscribeIdentityInvalid(listener: () => void) {
        transport.identity = listener
        return vi.fn()
      }
      // 将关闭操作转交共享模拟，保留调用参数用于断言。
      close = transport.close
      // 将销毁操作转交共享模拟，确认生命周期清理次数。
      dispose = transport.dispose
    },
  }),
)
// 当前用例的响应式作用域，结束后停止观察器并销毁客户端。
let scope: EffectScope
// 当前用例的独立 Agent 测试模块实例，每次初始化使用独立状态。
let module: ReturnType<typeof createUnifiedAgentTestModule>
// 替代浏览器窗口的事件目标，用于触发 pagehide、失焦等生命周期事件。
let windowTarget: EventTarget
// 可由测试修改的账号状态，用于验证身份变化和余额变化的处理差异。
let user: { currentUser: ReturnType<typeof ref<{ id: string; balance: string } | null>> }
// 可由测试修改的工程加载状态，分别控制设置和时间轴是否就绪。
let project: {
  isProjectSettingsReady: ReturnType<typeof ref<boolean>>
  isProjectTimelineReady: ReturnType<typeof ref<boolean>>
}
beforeEach(
  /** 构造就绪工程、账号及选择状态，在独立作用域中初始化模块。 */ () => {
    vi.clearAllMocks()
    windowTarget = new EventTarget()
    vi.stubGlobal('window', windowTarget)
    user = { currentUser: ref({ id: 'user-1', balance: '10' }) }
    project = { isProjectSettingsReady: ref(true), isProjectTimelineReady: ref(true) }
    const registry = new ModuleRegistry()
    registry.register('user', user)
    registry.register('config', { projectId: ref('project-1'), projectName: ref('Test') })
    registry.register('project', project)
    registry.register('selection', { selectedClipTimelineItemIds: ref(['clip-1']) })
    scope = effectScope()
    module = scope.run(
      /** 在可销毁的响应式作用域内创建 Agent 测试模块。 */ () =>
        createUnifiedAgentTestModule(registry),
    )!
  },
)
afterEach(
  /** 结束模块作用域并恢复测试替换的全局对象。 */ () => {
    scope.stop()
    vi.unstubAllGlobals()
  },
)
/** 模拟受理后返回的增量流，将完整结果保留到指定 Promise 完成。 */
function mockStream(final: Promise<unknown>) {
  return {
    /** 提供一条临时文本，用于确认模块会消费增量。 */
    async *[Symbol.asyncIterator]() {
      yield { delta: 'draft' }
    },
    /** 读取本轮最终结果，不重新发起模型调用。 */
    finalCompletion() {
      return final
    },
  }
}
/** 创建可手动完成的模型终态，以模拟账号或页面切换后的迟到响应。 */
function pending() {
  let resolve!: (value: unknown) => void
  transport.calls.mockResolvedValue(
    mockStream(
      new Promise(
        /** 保存模拟结果的完成入口。 */ (done) => {
          resolve = done
        },
      ),
    ),
  )
  return { resolve }
}
// 模块测试共用的完整成功结果，用于立即响应及迟到响应场景。
const completion = { turnId: 'turn', message: { role: 'assistant', content: 'reply' }, usage: null }

describe('unified Agent test module ownership and lifecycle', /** 组织独立测试模块的结果归属及生命周期测试。 */ () => {
  it('shows stream drafts and commits only the final completion', /** 验证增量先展示，收到完整结果后才提交完成状态并清空草稿。 */ async () => {
    const deferred = pending()
    const running = module.runSingleTurn('hello')
    await vi.waitFor(
      /** 等待模块消费已受理调用的首个增量。 */ () => {
        expect(module.test.value.draft).toBe('draft')
      },
    )
    expect(module.test.value.status).toBe('running')
    expect(module.test.value.completion).toBeNull()
    deferred.resolve(completion)
    await running
    expect(module.test.value.status).toBe('completed')
    expect(module.test.value.completion).toEqual(completion)
    expect(module.test.value.draft).toBe('')
  })
  it('does not call until both settings and timeline are ready, and uses project context', /** 验证工程全部就绪后才能调用，并使用当前工程上下文。 */ async () => {
    project.isProjectTimelineReady.value = false
    await module.runSingleTurn('hello')
    expect(transport.calls).not.toHaveBeenCalled()
    project.isProjectTimelineReady.value = true
    transport.calls.mockResolvedValue(mockStream(Promise.resolve(completion)))
    await module.runSingleTurn('hello')
    expect(transport.calls.mock.calls[0][0]).toMatchObject({
      projectId: 'project-1',
      messages: [
        { role: 'system', content: expect.stringContaining('核心规则') },
        { role: 'user', content: 'hello' },
      ],
    })
    const request = transport.calls.mock.calls[0][0]
    expect(request).not.toHaveProperty('context')
    expect(request.messages[0].content).toContain('当前阶段仅提供文本对话，没有可用工具')
    expect(request.messages[0].content).toContain(
      '工程上下文：{"project_id":"project-1","project_name":"Test","fps":30,"selected_clip_ids":["clip-1"]}',
    )
    expect(module.test.value.completion).toEqual(completion)
  })
  it('keeps each test call independent and generates fresh task and turn IDs', /** 验证每次调用仅包含当前消息，并生成新的任务和轮次 ID。 */ async () => {
    transport.calls.mockResolvedValue(mockStream(Promise.resolve(completion)))
    await module.runSingleTurn('first')
    await module.runSingleTurn('second')
    const first = transport.calls.mock.calls[0][0]
    const second = transport.calls.mock.calls[1][0]
    expect(second.messages).toEqual([
      { role: 'system', content: first.messages[0].content },
      { role: 'user', content: 'second' },
    ])
    expect(first.turnId).not.toBe(second.turnId)
    expect(first.taskId).not.toBe(second.taskId)
  })
  it('balance updates preserve the current run, while account changes discard late results', /** 验证余额更新保留调用，账号切换丢弃旧结果。 */ async () => {
    const deferred = pending()
    const running = module.runSingleTurn('hello')
    user.currentUser.value = { id: 'user-1', balance: '9' }
    expect(transport.close).not.toHaveBeenCalled()
    expect(module.test.value.status).toBe('running')
    user.currentUser.value = { id: 'user-2', balance: '9' }
    expect(transport.close).toHaveBeenCalledWith('IDENTITY_CHANGED')
    expect(transport.calls.mock.calls[0][1].signal.aborted).toBe(true)
    deferred.resolve(completion)
    await running
    expect(module.test.value.completion).toBeNull()
    expect(module.test.value.status).toBe('idle')
  })
  it('cleans pagehide, rejects late results, and leaves blank state when returning', /** 验证离开页面清空状态，迟到结果不会在返回后出现。 */ async () => {
    const deferred = pending()
    const running = module.runSingleTurn('hello')
    windowTarget.dispatchEvent(new Event('pagehide'))
    deferred.resolve(completion)
    await running
    expect(module.test.value.prompt).toBe('')
    expect(module.test.value.completion).toBeNull()
    expect(transport.close).toHaveBeenCalledWith('PAGE_LEFT')
  })
  it('does not stop on visibility changes or focus loss', /** 验证失焦或可见性变化不会中断正在运行的调用。 */ async () => {
    const deferred = pending()
    const running = module.runSingleTurn('hello')
    windowTarget.dispatchEvent(new Event('blur'))
    windowTarget.dispatchEvent(new Event('visibilitychange'))
    expect(transport.close).not.toHaveBeenCalled()
    expect(transport.calls.mock.calls[0][1].signal.aborted).toBe(false)
    deferred.resolve(completion)
    await running
    expect(module.test.value.status).toBe('completed')
  })
  it('blocks explicit identity invalidation until identity changes, and disposes on scope exit', /** 验证身份失效阻止调用，账号变化后恢复，作用域结束释放资源。 */ () => {
    transport.identity!()
    expect(module.ready.value).toBe(false)
    expect(module.test.value.error).toBe('IDENTITY_INVALID')
    user.currentUser.value = { id: 'user-2', balance: '0' }
    expect(module.ready.value).toBe(true)
    scope.stop()
    expect(transport.dispose).toHaveBeenCalledOnce()
    transport.close.mockClear()
    windowTarget.dispatchEvent(new Event('pagehide'))
    expect(transport.close).not.toHaveBeenCalled()
  })
})
