import type { ResourceDomainEvent, ResourceNode, ResourceRequest, ResourceType } from './ResourceTypes'

/**
 * isSatisfied() 使用的轻量上下文。
 *
 * 这个阶段只允许 resolver 读取当前节点和输入，不提供 ensure/update/emit，
 * 目的是把“快速判断是否已 ready”和“真正执行资源”分开。
 */
export interface ResolveCheckContext<TInput = unknown> {
  node: ResourceNode<TInput>
  input: TInput
}

/**
 * resolver.resolve() / getDependencies() / cancel() 使用的运行上下文。
 *
 * Runtime 通过这个对象给 resolver 最小必要能力：访问取消信号、动态 ensure
 * 其他资源、更新进度、发业务域事件。Resolver 不直接操作全局 DAG。
 */
export interface ResolveContext<TInput = unknown> {
  /** 当前正在处理的节点。可读状态，少量运行态更新应通过 update()。 */
  node: ResourceNode<TInput>
  input: TInput
  /** Runtime cancel() 时会 abort。Resolver 内部耗时逻辑需要主动监听。 */
  signal: AbortSignal
  /** 动态依赖入口。优先用 getDependencies() 声明静态依赖，动态场景再用它。 */
  ensure<TResult>(request: ResourceRequest): Promise<TResult>
  /** 更新 TaskCenter 可展示的短期运行信息。 */
  update(patch: { progress?: number; stage?: string; message?: string }): void
  /** 发给业务模块的领域事件，不改变 DAG 状态。 */
  emit(event: ResourceDomainEvent): void
}

/**
 * 单类资源的适配器。
 *
 * Runtime 只负责编排；资源“怎样算 ready、依赖谁、如何执行”都由 resolver 实现。
 */
export interface ResourceResolver<TInput = unknown, TResult = unknown> {
  /** resolver 支持的资源类型。 */
  type: ResourceType
  /** 从 input 生成稳定 key。key 必须可复现，不能包含随机数或会话态对象。 */
  getKey(input: TInput): string
  /** 可选快速检查：如果资源已 ready，直接返回结果，跳过依赖和执行。 */
  isSatisfied?(ctx: ResolveCheckContext<TInput>): Promise<TResult | null>
  /** 可选静态依赖声明。Runtime 会先 ensure 这些依赖，再运行当前节点。 */
  getDependencies?(ctx: ResolveContext<TInput>): Promise<ResourceRequest[]>
  /** 当前资源真正的执行逻辑。执行时可假设静态依赖已经成功。 */
  resolve(ctx: ResolveContext<TInput>): Promise<TResult>
  /** 可选取消逻辑，例如中断上传、轮询、导出。 */
  cancel?(ctx: ResolveContext<TInput>): Promise<void>
}

type AnyResourceResolver = ResourceResolver<any, any>

/**
 * resolver 注册表。
 *
 * 当前实现是 Runtime 私有依赖，保持简单的 type -> resolver 映射。
 */
export class ResourceResolverRegistry {
  private resolvers = new Map<ResourceType, AnyResourceResolver>()

  /** 同一个 type 只能注册一次，避免运行时出现资源解释歧义。 */
  register(resolver: AnyResourceResolver): void {
    if (this.resolvers.has(resolver.type)) {
      throw new Error(`Resource resolver already registered: ${resolver.type}`)
    }

    this.resolvers.set(resolver.type, resolver)
  }

  /** 找不到 resolver 直接抛错，让接入阶段尽早暴露配置遗漏。 */
  get(type: ResourceType): AnyResourceResolver {
    const resolver = this.resolvers.get(type)
    if (!resolver) {
      throw new Error(`No resource resolver registered for type: ${type}`)
    }

    return resolver
  }

  /** 供后续调试面板或按需注册检查使用。 */
  has(type: ResourceType): boolean {
    return this.resolvers.has(type)
  }
}
