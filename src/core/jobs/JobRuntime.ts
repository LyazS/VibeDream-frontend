import { DagScheduler } from './DagScheduler'
import { JobLogger } from './JobLogger'
import type { ResourceDomainEvent, ResourceResolver, ResolveContext } from './ResourceResolver'
import { ResourceResolverRegistry } from './ResourceResolverRegistry'
import {
  createResourceId,
  createResourceNode,
  type ResourceBinding,
  type ResourceNode,
  type ResourceNodePatch,
  type ResourceRequest,
  type ResourceStatus,
} from './ResourceTypes'
import { TaskViewAdapter, type TaskViewItem } from './TaskViewAdapter'

interface RuntimeEntry {
  node: ResourceNode<unknown, unknown>
  controller: AbortController
  promise: Promise<unknown>
  resolve: (value: unknown) => void
  reject: (reason?: unknown) => void
}

export type JobRuntimeListener = (nodes: ResourceNode[]) => void
export type JobDomainEventListener = (event: ResourceDomainEvent) => void

export interface JobRuntimeOptions {
  resolverRegistry?: ResourceResolverRegistry
  scheduler?: DagScheduler
  taskViewAdapter?: TaskViewAdapter
}

export class JobRuntime {
  private readonly resolverRegistry: ResourceResolverRegistry
  private readonly scheduler: DagScheduler
  private readonly taskViewAdapter: TaskViewAdapter
  private readonly nodes = new Map<string, ResourceNode>()
  private readonly entries = new Map<string, RuntimeEntry>()
  private readonly listeners = new Set<JobRuntimeListener>()
  private readonly domainEventListeners = new Set<JobDomainEventListener>()

  constructor(options: JobRuntimeOptions = {}) {
    this.resolverRegistry = options.resolverRegistry ?? new ResourceResolverRegistry()
    this.scheduler = options.scheduler ?? new DagScheduler()
    this.taskViewAdapter = options.taskViewAdapter ?? new TaskViewAdapter()
  }

  registerResolver(resolver: ResourceResolver): void {
    this.resolverRegistry.register(resolver)
  }

  ensure<TResult = unknown, TInput = unknown>(request: ResourceRequest<TInput>): Promise<TResult> {
    const resourceId = createResourceId(request)

    JobLogger.info('JobRuntime', 'ensure:start', {
      resourceId,
      type: request.type,
      key: request.key,
      bindings: request.bindings,
    })

    const existingEntry = this.entries.get(resourceId)
    const existingNode = this.nodes.get(resourceId) as ResourceNode<TInput, TResult> | undefined

    if (existingEntry && existingNode) {
      this.mergeBindings(existingNode, request.bindings)
      JobLogger.info('ResourceNode', 'node:dedupe', JobLogger.forNode(existingNode))
      this.notify()
      return existingEntry.promise as Promise<TResult>
    }

    if (existingNode?.status === 'succeeded') {
      this.mergeBindings(existingNode, request.bindings)
      JobLogger.info('ResourceNode', 'node:dedupe', JobLogger.forNode(existingNode))
      this.notify()
      return Promise.resolve(existingNode.result as TResult)
    }

    const node = existingNode ?? createResourceNode<TInput, TResult>(request)
    if (!existingNode) {
      this.nodes.set(node.id, node)
      JobLogger.info('ResourceNode', 'node:create', JobLogger.forNode(node))
    } else {
      node.input = request.input
      node.policy = { ...node.policy, ...request.policy }
      this.mergeBindings(node, request.bindings)
    }

    const controller = new AbortController()
    let resolveEntry!: (value: unknown) => void
    let rejectEntry!: (reason?: unknown) => void
    const promise = new Promise<unknown>((resolve, reject) => {
      resolveEntry = resolve
      rejectEntry = reject
    })

    const entry: RuntimeEntry = {
      node: node as ResourceNode<unknown, unknown>,
      controller,
      promise,
      resolve: resolveEntry,
      reject: rejectEntry,
    }

    this.entries.set(node.id, entry)
    this.transition(node, 'queued')
    this.scheduler.enqueue(node, () => this.executeNode(node, entry))

    return promise as Promise<TResult>
  }

  async cancel(resourceId: string): Promise<boolean> {
    const entry = this.entries.get(resourceId)
    const node = this.nodes.get(resourceId)
    if (!entry || !node) return false

    JobLogger.info('TaskCenter', 'action cancel', JobLogger.forNode(node))
    entry.controller.abort()

    const resolver = this.resolverRegistry.get(node.type)
    if (resolver?.cancel) {
      await resolver.cancel(this.createResolveContext(node, entry))
    }

    this.failEntryAsCancelled(entry)
    return true
  }

  retry<TResult = unknown>(resourceId: string): Promise<TResult> {
    const node = this.nodes.get(resourceId)
    if (!node) {
      return Promise.reject(new Error(`Resource node not found: ${resourceId}`))
    }

    JobLogger.info('JobRuntime', 'retry:start', JobLogger.forNode(node))
    node.error = undefined
    node.result = undefined
    node.progress = undefined
    return this.ensure<TResult>({
      type: node.type,
      key: node.key,
      input: node.input,
      bindings: node.bindings,
      policy: node.policy,
    })
  }

  getNode<TResult = unknown>(resourceId: string): ResourceNode<unknown, TResult> | undefined {
    return this.nodes.get(resourceId) as ResourceNode<unknown, TResult> | undefined
  }

  getNodes(): ResourceNode[] {
    return Array.from(this.nodes.values())
  }

  getTaskView(): TaskViewItem[] {
    return this.taskViewAdapter.toTaskView(this.nodes.values())
  }

  subscribe(listener: JobRuntimeListener): () => void {
    this.listeners.add(listener)
    listener(this.getNodes())
    return () => this.listeners.delete(listener)
  }

  subscribeDomainEvents(listener: JobDomainEventListener): () => void {
    this.domainEventListeners.add(listener)
    return () => this.domainEventListeners.delete(listener)
  }

  private async executeNode<TResult, TInput>(
    node: ResourceNode<TInput, TResult>,
    entry: RuntimeEntry,
  ): Promise<void> {
    if (node.status === 'cancelled') return

    const resolver = this.resolverRegistry.get<TInput, TResult>(node.type)
    if (!resolver) {
      this.failEntry(entry, new Error(`No resolver registered for resource type: ${node.type}`), {
        retryable: false,
      })
      return
    }

    node.attempt += 1
    this.transition(node, 'running')

    try {
      const context = this.createResolveContext<TInput, TResult>(node, entry)
      const satisfiedResult = await resolver.isSatisfied?.(context)

      if (satisfiedResult !== undefined && satisfiedResult !== null) {
        this.succeedEntry(entry, satisfiedResult)
        return
      }

      const dependencies = (await resolver.getDependencies?.(context)) ?? []
      node.deps = dependencies.map((dependency) => createResourceId(dependency))

      JobLogger.info('ResourceResolver', 'deps:resolved', {
        ...JobLogger.forNode(node),
        deps: node.deps.join(','),
      })

      for (const dependency of dependencies) {
        const dependencyId = createResourceId(dependency)
        const dependencyPromise = this.ensure(dependency)
        const dependencyNode = this.nodes.get(dependencyId)
        if (dependencyNode && !dependencyNode.dependents.includes(node.id)) {
          dependencyNode.dependents.push(node.id)
        }
        await dependencyPromise
      }

      const result = await resolver.resolve(context)
      this.succeedEntry(entry, result)
    } catch (error) {
      if (entry.controller.signal.aborted) {
        this.failEntryAsCancelled(entry)
        return
      }

      this.failEntry(entry, error)
    }
  }

  private createResolveContext<TInput = unknown, TResult = unknown>(
    node: ResourceNode<TInput, TResult>,
    entry: RuntimeEntry,
  ): ResolveContext<TInput> {
    return {
      node,
      input: node.input,
      signal: entry.controller.signal,
      ensure: (request) => this.ensure(request),
      update: (patch) => this.updateNode(node, patch),
      emit: (event) => this.emitDomainEvent(event),
    }
  }

  private updateNode(node: ResourceNode, patch: ResourceNodePatch): void {
    Object.assign(node, patch, { updatedAt: new Date().toISOString() })
    JobLogger.info('ResourceNode', 'node:progress', JobLogger.forNode(node))
    this.notify()
  }

  private transition(node: ResourceNode, status: ResourceStatus): void {
    const previousStatus = node.status
    node.status = status
    node.updatedAt = new Date().toISOString()

    JobLogger.info('ResourceNode', 'status', {
      ...JobLogger.forNode(node),
      fromStatus: previousStatus,
      toStatus: status,
    })

    this.notify()
  }

  private succeedEntry<TResult>(entry: RuntimeEntry, result: TResult): void {
    const node = entry.node
    node.result = result
    node.error = undefined
    node.progress = node.progress ?? 100
    this.transition(node, 'succeeded')
    JobLogger.info('ResourceNode', 'node:succeeded', JobLogger.forNode(node))
    this.entries.delete(node.id)
    entry.resolve(result)
  }

  private failEntry(
    entry: RuntimeEntry,
    error: unknown,
    options: { retryable?: boolean } = {},
  ): void {
    const node = entry.node
    node.error = {
      message: error instanceof Error ? error.message : String(error),
      retryable: options.retryable,
    }
    this.transition(node, 'failed')
    JobLogger.error('ResourceNode', 'node:failed', {
      ...JobLogger.forNode(node),
      error,
      retryable: options.retryable,
    })
    this.entries.delete(node.id)
    entry.reject(error)
  }

  private failEntryAsCancelled(entry: RuntimeEntry): void {
    const node = entry.node
    if (!this.entries.has(node.id)) return

    this.transition(node, 'cancelled')
    JobLogger.info('ResourceNode', 'node:cancelled', JobLogger.forNode(node))
    this.entries.delete(node.id)
    entry.reject(new Error(`Resource cancelled: ${node.id}`))
  }

  private mergeBindings(node: ResourceNode, bindings: ResourceBinding[] = []): void {
    for (const binding of bindings) {
      const exists = node.bindings.some(
        (existing) => existing.type === binding.type && existing.id === binding.id,
      )
      if (!exists) {
        node.bindings.push(binding)
      }
    }
    node.updatedAt = new Date().toISOString()
  }

  private emitDomainEvent(event: ResourceDomainEvent): void {
    for (const listener of this.domainEventListeners) {
      listener(event)
    }
  }

  private notify(): void {
    const nodes = this.getNodes()
    for (const listener of this.listeners) {
      listener(nodes)
    }
  }
}
