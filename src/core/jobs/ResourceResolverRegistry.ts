import { JobLogger } from './JobLogger'
import type { ResourceResolver } from './ResourceResolver'
import type { ResourceType } from './ResourceTypes'

export class ResourceResolverRegistry {
  private resolvers = new Map<ResourceType, ResourceResolver>()

  register(resolver: ResourceResolver): void {
    if (this.resolvers.has(resolver.type)) {
      JobLogger.warn('ResourceResolver', 'resolver:replace', { type: resolver.type })
    }

    this.resolvers.set(resolver.type, resolver)
    JobLogger.debug('ResourceResolver', 'resolver:register', { type: resolver.type })
  }

  unregister(type: ResourceType): boolean {
    const removed = this.resolvers.delete(type)
    if (removed) {
      JobLogger.debug('ResourceResolver', 'resolver:unregister', { type })
    }
    return removed
  }

  get<TInput = unknown, TResult = unknown>(
    type: ResourceType,
  ): ResourceResolver<TInput, TResult> | undefined {
    return this.resolvers.get(type) as ResourceResolver<TInput, TResult> | undefined
  }

  has(type: ResourceType): boolean {
    return this.resolvers.has(type)
  }

  getRegisteredTypes(): ResourceType[] {
    return Array.from(this.resolvers.keys())
  }
}
