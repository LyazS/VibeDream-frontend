/**
 * Resource-first 任务中心的核心类型定义。
 *
 * 这里的“资源”不是 UI 上的一条任务，而是业务真正想要的 ready 状态，
 * 例如 media-ready、asr-subtitles、exported-project。JobRuntime 根据这些
 * ResourceRequest 构建运行态 DAG，并把 DAG 投影成任务中心视图。
 */

/**
 * 资源类型。前面列出的是当前设计里明确会用到的资源类型。
 *
 * 末尾保留 `string` 是为了 MVP 阶段允许业务先注册实验性 resolver，
 * 不需要每加一个资源就先改这个联合类型；等资源模型稳定后可以再收窄。
 */
export type ResourceType =
  | 'media-ready'
  | 'media-source-processed'
  | 'media-file-available'
  | 'media-decoded'
  | 'timeline-item-ready'
  | 'uploaded-resource'
  | 'remote-task-submitted'
  | 'remote-task-completed'
  | 'ai-generated-media'
  | 'asr-subtitles'
  | 'visual-summary'
  | 'effect-template-ready'
  | 'scene-boundaries'
  | 'exported-project'
  | string

/**
 * ResourceNode 的运行态状态。
 *
 * idle: 节点已创建，但还没检查依赖或进入调度。
 * blocked: 上游依赖失败/取消，当前节点不能继续执行。
 * queued: 依赖已满足，正在队列里等待并发名额。
 * running: resolver.resolve() 正在执行。
 * succeeded / failed / cancelled: 终态。
 */
export type ResourceStatus =
  | 'idle'
  | 'blocked'
  | 'queued'
  | 'running'
  | 'succeeded'
  | 'failed'
  | 'cancelled'

/**
 * 调度队列。不同资源类型进入不同队列，避免重型本地计算、远程轮询和导出互相抢占。
 */
export type ResourceQueue = 'remote' | 'local-heavy' | 'export' | 'background'

/**
 * 运行策略，不参与资源身份计算。
 *
 * 同一个资源的身份只由 `type + key` 决定；policy 只影响运行方式。
 */
export interface ResourcePolicy {
  /** 数值越大越优先。后来的相同资源请求可以提高优先级，但不应降低。 */
  priority?: number
  /** 使用哪个并发队列。未指定时 Scheduler 会放入 background。 */
  queue?: ResourceQueue
  /** 预留给后续持久化恢复。MVP 只保留字段，不实现落盘。 */
  persist?: boolean
  /** 应用重启后如何恢复。MVP 只保留字段，不执行恢复策略。 */
  restore?: 'resume' | 'recompute' | 'mark-failed' | 'ignore'
  /** retry() 允许的最大次数。未指定表示 Runtime 不限制。 */
  maxRetries?: number
}

/** Runtime 保存的错误摘要，供 TaskCenter 展示和 retry 判断。 */
export interface ResourceError {
  message: string
  code?: string
  retryable?: boolean
}

/**
 * 业务模块传给 JobRuntime 的请求。
 *
 * 设计上 request 描述“我要什么资源 ready”，不是“我要执行哪个任务”。
 */
export interface ResourceRequest<TInput = unknown> {
  type: ResourceType
  /** 同类型资源内的稳定去重键。可以由便捷工厂或 resolver.getKey 生成。 */
  key: string
  /** resolver 执行需要的输入。注意不要放不可恢复的大型运行态对象。 */
  input: TInput
  policy?: ResourcePolicy
}

/**
 * DAG 中的运行态节点。
 *
 * ResourceNode 不是长期资源数据库。长期事实仍应写回 mediaItem、project、
 * cache 或业务域对象；这里保存的是一次运行所需的短期状态。
 */
export interface ResourceNode<TInput = unknown, TResult = unknown> {
  /** 通常为 `${type}:${key}`，也是 Runtime Map 的索引。 */
  id: string
  type: ResourceType
  key: string
  input: TInput
  status: ResourceStatus
  /** 当前节点依赖的上游资源 ID。 */
  deps: string[]
  /** 依赖当前节点的下游资源 ID，用于 TaskView 投影和后续共享取消/释放。 */
  dependents: string[]
  /** resolver 成功后的短期结果，会返回给等待 ensure() 的调用方。 */
  result?: TResult
  error?: ResourceError
  /** 0 到 1 的进度值。业务层如果使用百分比，需要自行转换。 */
  progress?: number
  /** 当前阶段，例如 uploading、polling、decoding。 */
  stage?: string
  /** 面向任务中心展示的简短状态文案。 */
  message?: string
  policy: ResourcePolicy
  /** 已重试次数，用于 maxRetries 限制。 */
  retryCount: number
  /** 外部业务入口 ensure(root) 的引用计数。MVP 暂不做自动释放，但先保留计数。 */
  externalRefCount: number
  /** 正在等待该节点 Promise 的调用方数量。 */
  waiterCount: number
  createdAt: string
  updatedAt: string
}

/**
 * Runtime 发出的节点级事件。
 *
 * TaskCenter 和调试面板应该订阅这些事件，而不是直接驱动 resolver。
 */
export type ResourceEvent =
  | { type: 'resource:created'; node: ResourceNode }
  | { type: 'resource:updated'; node: ResourceNode }
  | { type: 'resource:succeeded'; node: ResourceNode }
  | { type: 'resource:failed'; node: ResourceNode }
  | { type: 'resource:blocked'; node: ResourceNode }
  | { type: 'resource:cancelled'; node: ResourceNode }
  | { type: 'resource:released'; node: ResourceNode }

/**
 * Resolver 可发出的业务域事件。
 *
 * 这类事件不是 DAG 状态本身，而是给 MediaModule、TimelineModule 等业务模块
 * 同步自身状态使用。MVP 不强约束 payload 结构。
 */
export type ResourceDomainEvent = {
  type: string
  resourceId: string
  payload?: unknown
}

/** 统一生成资源 ID，确保 Runtime、TaskCenter、业务映射使用同一规则。 */
export function getResourceId(type: ResourceType, key: string): string {
  return `${type}:${key}`
}

/** 终态节点不会再被当前 promise 自动推进；retry() 会显式重开一次执行。 */
export function isTerminalResourceStatus(status: ResourceStatus): boolean {
  return (
    status === 'succeeded' || status === 'failed' || status === 'cancelled' || status === 'blocked'
  )
}

/**
 * 合并同一个 resourceId 的多次请求策略。
 *
 * 这里特意让 priority 只能升不能降，避免后来的低优先级请求拖慢已经在等的高优先级业务。
 */
export function mergeResourcePolicy(
  current: ResourcePolicy,
  next: ResourcePolicy | undefined,
): ResourcePolicy {
  if (!next) return current

  return {
    ...current,
    ...next,
    priority: Math.max(current.priority ?? 0, next.priority ?? 0),
  }
}

/** 根据 request 创建一个还未调度的运行态节点。 */
export function createResourceNode<TInput>(request: ResourceRequest<TInput>): ResourceNode<TInput> {
  const now = new Date().toISOString()

  return {
    id: getResourceId(request.type, request.key),
    type: request.type,
    key: request.key,
    input: request.input,
    status: 'idle',
    deps: [],
    dependents: [],
    policy: request.policy ?? {},
    retryCount: 0,
    externalRefCount: 0,
    waiterCount: 0,
    createdAt: now,
    updatedAt: now,
  }
}
