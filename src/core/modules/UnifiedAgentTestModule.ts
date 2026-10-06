import { computed, onScopeDispose, readonly, ref, watch } from 'vue'
import { API_BASE_URL } from '@/config/runtimeConfig'
import { FRAME_RATE } from '@/constants/TimeConstants'
import { buildTextMessages } from '@/aipanel/agent/prompts/textMessages'
import {
  AgentClient,
  AgentClientError,
  type Completion,
  type ConnectionState,
} from '@/aipanel/agent/transport/AgentClient'
import { MODULE_NAMES, type ModuleRegistry, type ModuleMap } from './ModuleRegistry'

/** 创建独立的 Agent 测试模块，由工程和账号状态管理单轮测试客户端及结果。 */
export function createUnifiedAgentTestModule(registry: ModuleRegistry) {
  // 当前账号来源，用于调用准入及异步结果的身份归属检查。
  const user = registry.get<ModuleMap['user']>(MODULE_NAMES.USER)
  // 工程标识和名称来源，在每次调用开始时读取并快照。
  const config = registry.get<ModuleMap['config']>(MODULE_NAMES.CONFIG)
  // 工程加载状态来源，设置和时间轴均就绪后才允许调用。
  const project = registry.get<ModuleMap['project']>(MODULE_NAMES.PROJECT)
  // 当前片段选择来源，所选 ID 会复制到本轮工程上下文。
  const selection = registry.get<ModuleMap['selection']>(MODULE_NAMES.SELECTION)
  // 服务端明确撤销身份后保持禁用，直到账号 ID 变化才重置。
  const identityInvalid = ref(false)
  // 模块共享的调用准入状态，供发送操作和测试面板使用。
  const ready = computed(
    /** 根据登录身份、工程加载完成状态及身份有效性计算可调用状态。 */ () =>
      Boolean(
        user.currentUser.value?.id &&
          config.projectId.value &&
          project.isProjectSettingsReady.value &&
          project.isProjectTimelineReady.value &&
          !identityInvalid.value,
      ),
  )
  // 客户端连接状态的响应式镜像，通过订阅更新并以只读接口导出。
  const connection = ref<ConnectionState>({
    status: 'disconnected',
    closeReason: null,
    error: null,
  })
  // 当前测试轮次的界面状态；清空、账号切换或离开工程时整体重置。
  const test = ref<{
    /** 测试生命周期状态，用于锁定操作和展示调用结果。 */
    status: 'idle' | 'running' | 'completed' | 'cancelled' | 'failed'
    /** 当前请求的轮次 ID，尚未发送测试时为 null。 */
    turnId: string | null
    /** 本轮输入快照，避免输入框后续修改影响结果展示。 */
    prompt: string
    /** 流式临时文本，完成、失败或取消后清空。 */
    draft: string
    /** 正常完成后返回的完整消息和用量，临时增量不写入此字段。 */
    completion: Completion | null
    /** 调用失败或身份失效的错误信息，供面板展示。 */
    error: string | null
    /** 服务端受理分类；断开连接时可能无法确认是否已受理。 */
    acceptance: string | null
    /** 本轮结束时记录的耗时，单位为毫秒。 */
    elapsedMs: number | null
  }>({
    status: 'idle',
    turnId: null,
    prompt: '',
    draft: '',
    completion: null,
    error: null,
    acceptance: null,
    elapsedMs: null,
  })
  // 当前测试的取消控制器，由停止、清空和退出操作共享；结束后释放。
  let controller: AbortController | undefined
  // 结果代次；新调用或清空时递增，使旧异步回调无法修改新状态。
  let epoch = 0
  // 测试模块唯一拥有的客户端，跨测试调用复用连接，作用域销毁时释放。
  const client = new AgentClient({
    url: /** 在连接时读取当前工程，生成同源且匹配 HTTP 安全级别的地址。 */ () => {
      if (!ready.value) throw new Error('PROJECT_NOT_READY')
      const url = new URL('/api/agent/ws', API_BASE_URL || globalThis.location.origin)
      url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:'
      url.searchParams.set('project_id', config.projectId.value)
      return url.toString()
    },
  })
  // 连接状态订阅的释放入口，模块作用域结束时调用。
  const unsubscribeConnection = client.subscribeConnection(
    /** 将传输层连接状态同步到测试模块。 */ (state) => {
      connection.value = state
    },
  )

  /** 通过取消信号停止当前测试，具体连接清理由客户端负责。 */
  function stopTest() {
    controller?.abort()
  }
  /** 递增结果代次并取消调用，清空状态，使旧轮次的迟到结果失效。 */
  function clearTest() {
    epoch += 1
    stopTest()
    controller = undefined
    test.value = {
      status: 'idle',
      turnId: null,
      prompt: '',
      draft: '',
      completion: null,
      error: null,
      acceptance: null,
      elapsedMs: null,
    }
  }
  /** 离开工程时清空测试并关闭连接，防止后台调用继续运行。 */
  function leaveProject() {
    clearTest()
    client.close('PAGE_LEFT')
  }
  // 身份失效订阅的释放入口，避免模块销毁后继续接收身份通知。
  const unsubscribeIdentity = client.subscribeIdentityInvalid(
    /** 身份失效时清空测试，并阻止当前身份继续调用。 */ () => {
      clearTest()
      identityInvalid.value = true
      test.value.error = 'IDENTITY_INVALID'
      test.value.status = 'failed'
    },
  )
  // 账号 ID 观察器的停止入口，模块销毁时解除响应式监听。
  const stopIdentityWatch = watch(
    /** 仅观察账号 ID，余额更新不触发连接重置。 */
    () => user.currentUser.value?.id,
    /** 账号切换时取消旧调用，关闭连接并重置身份失效标记。 */
    () => {
      clearTest()
      client.close('IDENTITY_CHANGED')
      identityInvalid.value = false
    },
    { flush: 'sync' },
  )
  // 工程就绪状态观察器的停止入口，与账号观察器一起在销毁时清理。
  const stopReadyWatch = watch(
    /** 观察工程设置和时间轴是否全部就绪。 */
    () => project.isProjectSettingsReady.value && project.isProjectTimelineReady.value,
    /** 工程离开就绪状态时关闭连接并清空测试。 */
    (value) => {
      if (!value) leaveProject()
    },
    { flush: 'sync' },
  )

  /**
   * 面板 submit() 经 store 调用本函数；buildTextMessages() 组装消息后交给 client.stream()。
   * 逐项消费增量更新 draft，finalCompletion() 返回后校验归属并提交完整结果。
   */
  async function runSingleTurn(prompt: string) {
    if (!ready.value || !prompt.trim() || test.value.status === 'running') return
    const generation = ++epoch
    const owner = user.currentUser.value!.id
    const projectId = config.projectId.value
    const abort = new AbortController()
    controller = abort
    const startedAt = performance.now()
    const turnId = crypto.randomUUID()
    test.value = {
      status: 'running',
      turnId,
      prompt,
      draft: '',
      completion: null,
      error: null,
      acceptance: null,
      elapsedMs: null,
    }
    const params = {
      turnId,
      taskId: crypto.randomUUID(),
      projectId,
      messages: buildTextMessages([{ role: 'user', content: prompt }], {
        projectId,
        projectName: config.projectName.value,
        fps: FRAME_RATE,
        selectedClipIds: [...selection.selectedClipTimelineItemIds.value],
      }),
    }
    const belongs = /** 校验结果仍属于当前代次、账号和工程，屏蔽迟到结果。 */ () =>
      generation === epoch &&
      owner === user.currentUser.value?.id &&
      projectId === config.projectId.value &&
      ready.value
    try {
      const output = await client.stream(params, { signal: abort.signal })
      for await (const chunk of output) {
        if (!belongs() || abort.signal.aborted) break
        test.value.draft += chunk.delta
      }
      const completion = await output.finalCompletion()
      if (!belongs() || abort.signal.aborted) return
      test.value.completion = completion
      test.value.draft = ''
      test.value.status = 'completed'
      test.value.acceptance = 'accepted'
    } catch (error) {
      if (!belongs()) return
      test.value.draft = ''
      test.value.error = error instanceof Error ? error.message : String(error)
      test.value.acceptance = error instanceof AgentClientError ? error.acceptance : 'unknown'
      test.value.status = abort.signal.aborted ? 'cancelled' : 'failed'
    } finally {
      if (generation === epoch) {
        controller = undefined
        test.value.elapsedMs = Math.round(performance.now() - startedAt)
      }
    }
  }

  globalThis.window?.addEventListener('pagehide', leaveProject)
  onScopeDispose(
    /** 模块作用域结束时解除监听和订阅，销毁客户端。 */ () => {
      leaveProject()
      stopIdentityWatch()
      stopReadyWatch()
      unsubscribeIdentity()
      unsubscribeConnection()
      globalThis.window?.removeEventListener('pagehide', leaveProject)
      client.dispose()
    },
  )
  return {
    ready,
    connection: readonly(connection),
    test: readonly(test),
    runSingleTurn,
    stopTest,
    clearTest,
    leaveProject,
  }
}

export type UnifiedAgentTestModule = ReturnType<typeof createUnifiedAgentTestModule>
