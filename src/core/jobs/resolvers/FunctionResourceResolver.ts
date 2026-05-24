import type { ResolveContext, ResourceResolver } from '../ResourceResolver'
import type { ResourceRequest, ResourceType } from '../ResourceTypes'

/**
 * FunctionResourceResolver 的配置。
 *
 * 这是 MVP 阶段的便捷适配器：不用为每个 demo 或小实验新建一个 class，
 * 直接传函数就能注册 resolver。真实业务稳定后仍建议写具名 resolver 文件。
 */
export interface FunctionResourceResolverOptions<TInput, TResult> {
  type: ResourceType
  getKey: (input: TInput) => string
  isSatisfied?: (input: TInput) => Promise<TResult | null> | TResult | null
  getDependencies?: (input: TInput) => Promise<ResourceRequest[]> | ResourceRequest[]
  resolve: (ctx: ResolveContext<TInput>) => Promise<TResult> | TResult
}

/**
 * 用函数对象包装 ResourceResolver 接口。
 *
 * 适合：
 * - 写本地 demo 验证 DAG 去重/依赖/事件。
 * - 临时包裹现有异步函数，确认接入方式。
 *
 * 不适合承载复杂业务长期逻辑；复杂资源应实现独立 resolver，便于测试和维护。
 */
export class FunctionResourceResolver<TInput = unknown, TResult = unknown>
  implements ResourceResolver<TInput, TResult>
{
  readonly type: ResourceType
  private options: FunctionResourceResolverOptions<TInput, TResult>

  constructor(options: FunctionResourceResolverOptions<TInput, TResult>) {
    this.type = options.type
    this.options = options
  }

  /** 委托给调用方提供的 getKey，保持 resourceId 规则仍由 Runtime 统一拼接。 */
  getKey(input: TInput): string {
    return this.options.getKey(input)
  }

  /** 未提供 isSatisfied 时返回 null，表示资源尚未满足，需要继续执行。 */
  async isSatisfied({ input }: { input: TInput }): Promise<TResult | null> {
    return (await this.options.isSatisfied?.(input)) ?? null
  }

  /** 未提供依赖时返回空数组，表示当前资源可直接进入调度。 */
  async getDependencies({ input }: { input: TInput }): Promise<ResourceRequest[]> {
    return (await this.options.getDependencies?.(input)) ?? []
  }

  /** 支持同步或异步函数，统一包装成 Promise 以符合 ResourceResolver 接口。 */
  async resolve(ctx: ResolveContext<TInput>): Promise<TResult> {
    return await this.options.resolve(ctx)
  }
}
