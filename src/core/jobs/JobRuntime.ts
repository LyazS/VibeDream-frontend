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
 * - 维护 DAG 边、状态、等待者和取消。
 * - 发布 ResourceEvent，供 TaskCenter 或业务模块订阅。
 *
 * Runtime 不负责：
 * - 具体业务如何执行，例如媒体解码、远程轮询。
 * - 直接修改 mediaItem / timeline / project。
 * - 当前 MVP 中的持久化恢复。
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
   * 取消某个资源节点，并沿独占子依赖递归传播取消。
   *
   * 策略：只取消独占子节点——断边后，如果依赖节点不再被其他路径依赖且无外部等待，
   * 才递归取消。共享依赖只断边，不影响其他 root。
   */
  async cancel(resourceId: string): Promise<boolean> {
    const node = this.nodes.get(resourceId)
    if (!node || isTerminalResourceStatus(node.status)) {
      return false
    }

    const cancelled = await this.cancelSingleNode(resourceId)
    if (cancelled) {
      await this.propagateCancelFromNode(node)
    }
    return cancelled
  }

  /**
   * 取消单个节点：abort signal、调用 resolver.cancel()、推进状态。
   * 不负责断边或传播。返回是否成功取消。
   */
  private async cancelSingleNode(resourceId: string): Promise<boolean> {
    const node = this.nodes.get(resourceId)
    const entry = this.entries.get(resourceId)
    if (!node || !entry || isTerminalResourceStatus(node.status)) {
      return false
    }

    const resolver = this.registry.get(node.type)
    const context = this.createResolveContext(node, entry.controller)

    try {
      await resolver.cancel?.(context)
    } catch (error) {
      console.warn(`[JobRuntime] Resolver cancel failed: ${resourceId}`, error)
      return false
    }

    this.scheduler.cancelQueued(resourceId)
    entry.controller.abort()

    this.setStatus(node, 'cancelled')
    this.emitResourceEvent({ type: 'resource:cancelled', node })
    this.tryReleaseNode(node.id)
    return true
  }

  /**
   * 对已取消节点的依赖执行独占传播取消。
   *
   * 流程：遍历 deps 快照 → 断边 → 分流处理：
   * - succeeded: 尝试释放
   * - 终态(failed/cancelled): 跳过
   * - 非终态且无其他引用: 递归取消
   */
  private async propagateCancelFromNode(node: ResourceNode): Promise<void> {
    const depIds = [...node.deps]

    for (const depId of depIds) {
      await this.handleDetachedDependency(node.id, depId)
    }
  }

  /**
   * 处理父节点取消后断开的单个依赖。
   *
   * 先断边，再根据依赖状态分流：
   * - succeeded → tryReleaseNode
   * - 终态(failed/cancelled) → 跳过
   * - 非终态 + 无其他引用 → 取消 + 递归传播
   */
  private async handleDetachedDependency(parentId: string, depId: string): Promise<void> {
    this.disconnect(parentId, depId)

    const dependency = this.nodes.get(depId)
    if (!dependency) {
      return
    }

    if (dependency.status === 'succeeded') {
      this.tryReleaseNode(dependency.id)
      return
    }

    if (isTerminalResourceStatus(dependency.status)) {
      return
    }

    if (dependency.dependents.length > 0 || dependency.externalWaiterCount > 0) {
      return
    }

    const cancelled = await this.cancelSingleNode(dependency.id)
    if (cancelled) {
      await this.propagateCancelFromNode(dependency)
    }
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

    // 失败/取消的节点不会被隐式重跑，业务需要重新 ensure root request。
    if (node.status === 'failed' || node.status === 'cancelled') {
      throw this.createNodeError(node)
    }

    // 多个 ensure 同一 resourceId 时会共享同一个 entry.promise，实现执行去重。
    const entry = this.getOrCreateEntry(node)
    node.waiterCount += 1
    if (external) {
      node.externalWaiterCount += 1
    }
    this.touch(node)
    console.log('[JobRuntime][ensureNode] waiter +1', {
      resourceId: node.id,
      waiterCount: node.waiterCount,
      externalWaiterCount: node.externalWaiterCount,
      external,
    })

    try {
      return (await entry.promise) as TResult
    } finally {
      node.waiterCount = Math.max(0, node.waiterCount - 1)
      if (external) {
        node.externalWaiterCount = Math.max(0, node.externalWaiterCount - 1)
      }
      this.touch(node)
      console.log('[JobRuntime][ensureNode] waiter -1', {
        resourceId: node.id,
        waiterCount: node.waiterCount,
        externalWaiterCount: node.externalWaiterCount,
        status: node.status,
      })

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
      // 取消是独立终态。其他错误统一收敛到 failed。
      if (isAbortError(error)) {
        if (node.status !== 'cancelled') {
          this.setStatus(node, 'cancelled')
          this.emitResourceEvent({ type: 'resource:cancelled', node })
        }
        this.tryReleaseNode(node.id)
      } else {
        this.markFailed(node, error)
        this.tryReleaseNode(node.id)
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

    if (!isTerminalResourceStatus(node.status)) {
      console.log('[JobRuntime][release] keep node because status not releasable', {
        resourceId: node.id,
        status: node.status,
      })
      return
    }

    if (node.externalWaiterCount > 0 || node.dependents.length > 0) {
      console.log('[JobRuntime][release] keep node because still referenced', {
        resourceId: node.id,
        externalWaiterCount: node.externalWaiterCount,
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

  private createNodeError(node: ResourceNode): Error {
    return new Error(node.error?.message ?? `Resource ${node.id} is ${node.status}`)
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
