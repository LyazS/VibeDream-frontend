import { DagScheduler, type DagSchedulerOptions } from './DagScheduler'
import {
  createResourceNode,
  getResourceId,
  isTerminalResourceStatus,
  mergeResourcePolicy,
  type ResourceDomainEvent,
  type ResourceEvent,
  type ResourceNode,
  type ResourceRequest,
  type ResourceStatus,
  type ResourceType,
} from './ResourceTypes'
import {
  ResourceResolverRegistry,
  type ResolveContext,
  type ResourceResolver,
} from './ResourceResolver'
import { createTaskViews, type TaskView } from './TaskViewAdapter'

export interface JobRuntimeOptions {
  /** 测试或更高层运行时可注入自定义 scheduler；正常业务不需要传。 */
  scheduler?: DagScheduler
  /** 使用默认 scheduler 时，允许覆盖队列并发。 */
  schedulerOptions?: DagSchedulerOptions
}

type ResourceEventListener = (event: ResourceEvent) => void
type DomainEventListener = (event: ResourceDomainEvent) => void

/**
 * ResourceNode 之外的不可序列化运行态。
 *
 * 这些对象不能进入 ResourceNode，因为后续持久化恢复时无法保存 AbortController
 * 或 Promise。ResourceNode 只保存可展示/可恢复的短期状态。
 */
interface RuntimeEntry {
  controller: AbortController
  promise?: Promise<unknown>
}

/**
 * Resource-first 任务中心的 MVP Runtime。
 *
 * Runtime 的职责：
 * - 根据 type + key 去重 ResourceNode。
 * - 调用 resolver 检查资源是否已满足、声明依赖、执行资源。
 * - 维护 DAG 边、状态、等待者、取消和 retry。
 * - 发布 ResourceEvent，供 TaskCenter 或业务模块订阅。
 *
 * Runtime 不负责：
 * - 具体业务如何执行，例如媒体解码、远程轮询。
 * - 直接修改 mediaItem / timeline / project。
 * - 当前 MVP 中的持久化恢复、节点自动释放、复杂共享取消传播。
 */
export class JobRuntime {
  /** resourceId -> ResourceNode。DAG 的运行态主存储。 */
  private nodes = new Map<string, ResourceNode>()
  /** resourceId -> AbortController/Promise 等不可序列化运行态。 */
  private entries = new Map<string, RuntimeEntry>()
  private registry = new ResourceResolverRegistry()
  private scheduler: DagScheduler
  private resourceListeners = new Set<ResourceEventListener>()
  private domainListeners = new Set<DomainEventListener>()

  constructor(options: JobRuntimeOptions = {}) {
    this.scheduler = options.scheduler ?? new DagScheduler(options.schedulerOptions)
  }

  registerResolver(resolver: ResourceResolver<any, any>): void {
    this.registry.register(resolver)
  }

  /**
   * 业务入口：声明“我需要这个资源 ready”。
   *
   * external=true 表示这是一个外部 root 请求。
   * resolver 内部调用 ctx.ensure() 时 external=false，只作为 DAG 内部依赖。
   */
  async ensure<TResult>(request: ResourceRequest): Promise<TResult> {
    return this.ensureNode<TResult>(this.normalizeRequest(request), undefined, true)
  }

  /**
   * 取消某个资源节点。
   *
   * MVP 只取消当前 resourceId 本身：
   * - 如果还在 Scheduler 队列里，会从队列移除。
   * - 如果已经运行，会 abort signal，并调用 resolver.cancel()。
   *
   * 暂不做“只取消独占子依赖”的复杂传播，避免误伤共享资源。
   */
  async cancel(resourceId: string): Promise<boolean> {
    const node = this.nodes.get(resourceId)
    const entry = this.entries.get(resourceId)
    if (!node || !entry || isTerminalResourceStatus(node.status)) {
      return false
    }

    this.scheduler.cancelQueued(resourceId)
    entry.controller.abort()

    const resolver = this.registry.get(node.type)
    const context = this.createResolveContext(node, entry.controller)

    try {
      await resolver.cancel?.(context)
    } catch (error) {
      console.warn(`[JobRuntime] Resolver cancel failed: ${resourceId}`, error)
    }

    this.setStatus(node, 'cancelled')
    this.emitResourceEvent({ type: 'resource:cancelled', node })
    this.tryReleaseNode(node.id)
    return true
  }

  /**
   * 重试失败、取消或 blocked 的节点。
   *
   * 当前实现只重试这个节点，不自动重算所有下游；后续 TaskCenter 可以根据用户操作
   * 再扩展“重试整条 root 路径”。
   */
  retry(resourceId: string): Promise<boolean> {
    const node = this.nodes.get(resourceId)
    if (!node) return Promise.resolve(false)

    if (node.status !== 'failed' && node.status !== 'cancelled' && node.status !== 'blocked') {
      return Promise.resolve(false)
    }

    const maxRetries = node.policy.maxRetries
    if (typeof maxRetries === 'number' && node.retryCount >= maxRetries) {
      return Promise.resolve(false)
    }

    node.retryCount += 1
    node.error = undefined
    node.result = undefined
    node.progress = undefined
    node.stage = undefined
    node.message = undefined
    node.updatedAt = new Date().toISOString()

    const entry: RuntimeEntry = { controller: new AbortController() }
    this.entries.set(resourceId, entry)
    entry.promise = this.runNode(node, entry)
    this.emitResourceEvent({ type: 'resource:updated', node })

    return entry.promise.then(
      () => true,
      () => true,
    )
  }

  /** 查询单个运行态节点，供调试面板或 TaskCenter 使用。 */
  getNode(resourceId: string): ResourceNode | undefined {
    return this.nodes.get(resourceId)
  }

  /** 查询所有运行态节点。返回的是节点引用，调用方不应直接改写。 */
  getNodes(): ResourceNode[] {
    return Array.from(this.nodes.values())
  }

  /** 将当前 DAG 投影成任务中心可展示的 root 任务列表。 */
  getTaskViews(): TaskView[] {
    return createTaskViews(this.getNodes())
  }

  /** 订阅资源节点事件，返回取消订阅函数。 */
  onResourceEvent(listener: ResourceEventListener): () => void {
    this.resourceListeners.add(listener)
    return () => this.resourceListeners.delete(listener)
  }

  /** 订阅 resolver 主动发出的业务域事件。 */
  onDomainEvent(listener: DomainEventListener): () => void {
    this.domainListeners.add(listener)
    return () => this.domainListeners.delete(listener)
  }

  private async ensureNode<TResult>(
    request: ResourceRequest,
    parentResourceId: string | undefined,
    external: boolean,
  ): Promise<TResult> {
    const node = this.getOrCreateNode(request)
    console.log('[JobRuntime][ensureNode] enter', {
      resourceId: node.id,
      status: node.status,
      external,
      parentResourceId,
      deps: node.deps,
      dependents: node.dependents,
      waiterCount: node.waiterCount,
    })

    // parent -> dependency 的边在这里建立。注意 deps 存在 parent 上。
    if (parentResourceId) {
      this.connect(parentResourceId, node.id)
    }

    // 已成功的节点直接共享结果，不重复执行 resolver。
    if (node.status === 'succeeded') {
      console.log('[JobRuntime][ensureNode] reuse succeeded node', {
        resourceId: node.id,
        result: node.result,
      })
      return node.result as TResult
    }

    // 失败/取消/阻塞的节点不会被隐式重跑，调用方需要显式 retry()。
    if (node.status === 'failed' || node.status === 'blocked' || node.status === 'cancelled') {
      throw this.createNodeError(node)
    }

    // 多个 ensure 同一 resourceId 时会共享同一个 entry.promise，实现执行去重。
    const entry = this.getOrCreateEntry(node)
    node.waiterCount += 1
    this.touch(node)
    console.log('[JobRuntime][ensureNode] waiter +1', {
      resourceId: node.id,
      waiterCount: node.waiterCount,
    })

    try {
      return (await entry.promise) as TResult
    } finally {
      const previousWaiterCount = node.waiterCount

      node.waiterCount = Math.max(0, node.waiterCount - 1)
      this.touch(node)
      console.log('[JobRuntime][ensureNode] waiter -1', {
        resourceId: node.id,
        waiterCount: node.waiterCount,
        status: node.status,
      })

      const hasVisibleReferenceChange =
        node.waiterCount !== previousWaiterCount && node.waiterCount > 0

      if (hasVisibleReferenceChange) {
        this.emitResourceEvent({ type: 'resource:updated', node })
      }

      this.tryReleaseNode(node.id)
    }
  }

  private getOrCreateNode(request: ResourceRequest): ResourceNode {
    const existing = this.nodes.get(getResourceId(request.type, request.key))
    if (existing) {
      // 同一个资源后续请求可以提高优先级或补充 policy，但不会创建新节点。
      existing.policy = mergeResourcePolicy(existing.policy, request.policy)
      this.touch(existing)
      console.log('[JobRuntime][getOrCreateNode] reuse existing node', {
        resourceId: existing.id,
        status: existing.status,
        deps: existing.deps,
        dependents: existing.dependents,
      })
      this.emitResourceEvent({ type: 'resource:updated', node: existing })
      return existing
    }

    const node = createResourceNode(request)
    console.log('[JobRuntime][getOrCreateNode] create node', {
      resourceId: node.id,
      input: request.input,
      policy: request.policy,
    })
    this.nodes.set(node.id, node)
    this.entries.set(node.id, {
      controller: new AbortController(),
    })
    this.emitResourceEvent({ type: 'resource:created', node })
    return node
  }

  private getOrCreateEntry(node: ResourceNode): RuntimeEntry {
    const entry = this.entries.get(node.id) ?? {
      controller: new AbortController(),
    }

    if (!entry.promise) {
      // 第一个等待者负责启动执行；后续等待者只 await 同一个 Promise。
      console.log('[JobRuntime][getOrCreateEntry] create promise', {
        resourceId: node.id,
      })
      entry.promise = this.runNode(node, entry)
      this.entries.set(node.id, entry)
    } else {
      console.log('[JobRuntime][getOrCreateEntry] reuse promise', {
        resourceId: node.id,
        status: node.status,
      })
    }

    return entry
  }

  private async runNode<TResult>(node: ResourceNode, entry: RuntimeEntry): Promise<TResult> {
    const resolver = this.registry.get(node.type)
    const context = this.createResolveContext(node, entry.controller)
    console.log('[JobRuntime][runNode] start', {
      resourceId: node.id,
      type: node.type,
      input: node.input,
    })

    try {
      // 先让 resolver 判断资源是否已经 ready。满足时跳过依赖构建和调度。
      const satisfied = await resolver.isSatisfied?.({ node, input: node.input })
      if (satisfied !== undefined && satisfied !== null) {
        console.log('[JobRuntime][runNode] satisfied before run', {
          resourceId: node.id,
          result: satisfied,
        })
        this.markSucceeded(node, satisfied)
        return satisfied as TResult
      }

      // 静态依赖先全部 ensure。任一依赖失败时 Promise.all 会进入 catch。
      const dependencies = (await resolver.getDependencies?.(context)) ?? []
      console.log('[JobRuntime][runNode] dependencies resolved', {
        resourceId: node.id,
        dependencies: dependencies.map((dependency) => `${dependency.type}:${dependency.key}`),
      })
      await Promise.all(
        dependencies.map((dependency) =>
          this.ensureNode(this.normalizeRequest(dependency), node.id, false),
        ),
      )

      if (entry.controller.signal.aborted) {
        throw new DOMException('Resource cancelled before execution', 'AbortError')
      }

      // 依赖成功后才进入队列。queued/running 由 Runtime 更新，Scheduler 不直接改节点。
      this.setStatus(node, 'queued')
      const result = await this.scheduler.enqueue(node, async () => {
        if (entry.controller.signal.aborted) {
          throw new DOMException('Resource cancelled before execution', 'AbortError')
        }

        this.setStatus(node, 'running')
        return resolver.resolve(context)
      })

      console.log('[JobRuntime][runNode] resolve completed', {
        resourceId: node.id,
        result,
      })
      this.markSucceeded(node, result)
      return result as TResult
    } catch (error) {
      console.log('[JobRuntime][runNode] failed', {
        resourceId: node.id,
        error: error instanceof Error ? error.message : String(error),
      })
      // 取消是独立终态。其他错误如果来自失败依赖，则当前节点标记为 blocked。
      if (isAbortError(error)) {
        this.setStatus(node, 'cancelled')
        this.emitResourceEvent({ type: 'resource:cancelled', node })
        this.tryReleaseNode(node.id)
      } else if (node.deps.some((depId) => this.isBlockedByDependency(depId))) {
        this.markBlocked(node, error)
      } else {
        this.markFailed(node, error)
      }

      throw error
    }
  }

  private createResolveContext<TInput>(
    node: ResourceNode<TInput>,
    controller: AbortController,
  ): ResolveContext<TInput> {
    // 暴露给 resolver 的最小能力集合。Resolver 不应直接操作 nodes/entries/scheduler。
    return {
      node,
      input: node.input,
      signal: controller.signal,
      ensure: <TResult>(request: ResourceRequest) =>
        this.ensureNode<TResult>(this.normalizeRequest(request), node.id, false),
      update: (patch) => {
        // Runtime 统一钳制进度范围，避免 resolver 写入非法展示值。
        if (typeof patch.progress === 'number') {
          node.progress = Math.max(0, Math.min(1, patch.progress))
        }
        if (patch.stage !== undefined) node.stage = patch.stage
        if (patch.message !== undefined) node.message = patch.message
        this.touch(node)
        this.emitResourceEvent({ type: 'resource:updated', node })
      },
      emit: (event) => this.emitDomainEvent(event),
    }
  }

  private normalizeRequest<TInput>(request: ResourceRequest<TInput>): ResourceRequest<TInput> {
    if (request.key) return request

    // 允许调用方省略 key，但 resolver 必须能从 input 推导稳定 key。
    const resolver = this.registry.get(request.type)
    return {
      ...request,
      key: resolver.getKey(request.input),
    }
  }

  private connect(parentResourceId: string, dependencyResourceId: string): void {
    const parent = this.nodes.get(parentResourceId)
    const dependency = this.nodes.get(dependencyResourceId)
    if (!parent || !dependency) return

    // 双向边都要维护：parent.deps 用于执行/展示，dependency.dependents 用于 root 投影。
    if (!parent.deps.includes(dependencyResourceId)) {
      parent.deps.push(dependencyResourceId)
      this.touch(parent)
      this.emitResourceEvent({ type: 'resource:updated', node: parent })
    }

    if (!dependency.dependents.includes(parentResourceId)) {
      dependency.dependents.push(parentResourceId)
      this.touch(dependency)
      this.emitResourceEvent({ type: 'resource:updated', node: dependency })
    }
  }

  private disconnect(parentResourceId: string, dependencyResourceId: string): void {
    console.log('[JobRuntime][disconnect] remove edge', {
      parentResourceId,
      dependencyResourceId,
    })
    const parent = this.nodes.get(parentResourceId)
    const dependency = this.nodes.get(dependencyResourceId)

    if (parent) {
      const nextDeps = parent.deps.filter((id) => id !== dependencyResourceId)
      if (nextDeps.length !== parent.deps.length) {
        parent.deps = nextDeps
        this.touch(parent)
        this.emitResourceEvent({ type: 'resource:updated', node: parent })
      }
    }

    if (dependency) {
      const nextDependents = dependency.dependents.filter((id) => id !== parentResourceId)
      if (nextDependents.length !== dependency.dependents.length) {
        dependency.dependents = nextDependents
        this.touch(dependency)
        this.emitResourceEvent({ type: 'resource:updated', node: dependency })
      }
    }
  }

  private tryReleaseNode(resourceId: string): void {
    const node = this.nodes.get(resourceId)
    if (!node) {
      return
    }

    if (node.status !== 'succeeded') {
      console.log('[JobRuntime][release] keep node because status not releasable', {
        resourceId: node.id,
        status: node.status,
      })
      return
    }

    if (node.waiterCount > 0 || node.dependents.length > 0) {
      console.log('[JobRuntime][release] keep node because still referenced', {
        resourceId: node.id,
        waiterCount: node.waiterCount,
        dependents: node.dependents,
      })
      return
    }

    const dependencyIds = [...node.deps]
    console.log('[JobRuntime][release] releasing node', {
      resourceId: node.id,
      dependencyIds,
      result: node.result,
    })

    for (const dependencyId of dependencyIds) {
      this.disconnect(node.id, dependencyId)
    }

    this.entries.delete(node.id)
    this.nodes.delete(node.id)
    this.emitResourceEvent({ type: 'resource:released', node })

    for (const dependencyId of dependencyIds) {
      this.tryReleaseNode(dependencyId)
    }
  }

  private setStatus(node: ResourceNode, status: ResourceStatus): void {
    node.status = status
    this.touch(node)
    this.emitResourceEvent({ type: 'resource:updated', node })
  }

  private markSucceeded(node: ResourceNode, result: unknown): void {
    node.result = result
    node.error = undefined
    node.progress = 1
    node.status = 'succeeded'
    this.touch(node)
    this.emitResourceEvent({ type: 'resource:succeeded', node })
  }

  private markFailed(node: ResourceNode, error: unknown): void {
    node.error = {
      message: error instanceof Error ? error.message : String(error),
      retryable: true,
    }
    node.status = 'failed'
    this.touch(node)
    this.emitResourceEvent({ type: 'resource:failed', node })
  }

  private markBlocked(node: ResourceNode, error: unknown): void {
    node.error = {
      message: error instanceof Error ? error.message : String(error),
      retryable: true,
    }
    node.status = 'blocked'
    this.touch(node)
    this.emitResourceEvent({ type: 'resource:blocked', node })
  }

  private createNodeError(node: ResourceNode): Error {
    return new Error(node.error?.message ?? `Resource ${node.id} is ${node.status}`)
  }

  private isBlockedByDependency(resourceId: string): boolean {
    const dependency = this.nodes.get(resourceId)
    return (
      dependency?.status === 'failed' ||
      dependency?.status === 'blocked' ||
      dependency?.status === 'cancelled'
    )
  }

  private touch(node: ResourceNode): void {
    node.updatedAt = new Date().toISOString()
  }

  private emitResourceEvent(event: ResourceEvent): void {
    // 按用户要求直接使用原生 console.log，不额外抽象 logger。
    console.log(`[JobRuntime] ${formatResourceEvent(event)}`)

    for (const listener of this.resourceListeners) {
      listener(event)
    }
  }

  private emitDomainEvent(event: ResourceDomainEvent): void {
    for (const listener of this.domainListeners) {
      listener(event)
    }
  }
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError'
}

function formatResourceEvent(event: ResourceEvent): string {
  return `${event.type} ${event.node.id} ${event.node.status}`
}

export function createJobRuntime(options?: JobRuntimeOptions): JobRuntime {
  return new JobRuntime(options)
}
