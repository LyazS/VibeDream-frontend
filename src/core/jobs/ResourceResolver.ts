import type {
  ResourceNode,
  ResourceNodePatch,
  ResourceRequest,
  ResourceType,
} from './ResourceTypes'

export interface ResourceDomainEvent<TPayload = unknown> {
  type: string
  resourceId: string
  payload?: TPayload
}

export interface ResolveCheckContext<TInput = unknown> {
  node: ResourceNode<TInput>
  input: TInput
  signal: AbortSignal
}

export interface ResolveContext<TInput = unknown> extends ResolveCheckContext<TInput> {
  ensure<TResult = unknown>(request: ResourceRequest): Promise<TResult>
  update(patch: ResourceNodePatch): void
  emit(event: ResourceDomainEvent): void
}

export interface ResourceResolver<TInput = unknown, TResult = unknown> {
  type: ResourceType
  getKey(input: TInput): string
  isSatisfied?(ctx: ResolveCheckContext<TInput>): Promise<TResult | null>
  getDependencies?(ctx: ResolveContext<TInput>): Promise<ResourceRequest[]>
  resolve(ctx: ResolveContext<TInput>): Promise<TResult>
  cancel?(ctx: ResolveContext<TInput>): Promise<void>
  restore?(node: ResourceNode<TInput, TResult>): Promise<'resume' | 'recompute' | 'fail' | 'ignore'>
}
