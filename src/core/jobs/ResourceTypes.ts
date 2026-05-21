export type ResourceType =
  | 'media-ready'
  | 'media-file-available'
  | 'media-decoded'
  | 'uploaded-resource'
  | 'remote-task-completed'
  | 'ai-generated-media'
  | 'asr-subtitles'
  | 'visual-summary'
  | 'effect-template-ready'
  | 'scene-boundaries'
  | 'exported-project'
  | (string & {})

export type ResourceStatus =
  | 'idle'
  | 'blocked'
  | 'queued'
  | 'running'
  | 'succeeded'
  | 'failed'
  | 'cancelled'

export type ResourceBinding =
  | { type: 'media-item'; id: string }
  | { type: 'timeline-item'; id: string }
  | { type: 'directory'; id: string }
  | { type: 'effect-template'; id: string }
  | { type: 'project'; id: string }
  | { type: string; id: string }

export interface ResourcePolicy {
  priority?: number
  queue?: 'remote' | 'local-heavy' | 'export' | 'background'
  persist?: boolean
  restore?: 'resume' | 'recompute' | 'mark-failed' | 'ignore'
  maxRetries?: number
}

export interface ResourceRequest<TInput = unknown> {
  type: ResourceType
  key: string
  input: TInput
  bindings?: ResourceBinding[]
  policy?: ResourcePolicy
}

export interface ResourceError {
  message: string
  code?: string
  retryable?: boolean
}

export interface ResourceNode<TInput = unknown, TResult = unknown> {
  id: string
  type: ResourceType
  key: string
  input: TInput
  status: ResourceStatus
  deps: string[]
  dependents: string[]
  result?: TResult
  error?: ResourceError
  progress?: number
  stage?: string
  message?: string
  bindings: ResourceBinding[]
  policy: ResourcePolicy
  attempt: number
  createdAt: string
  updatedAt: string
}

export interface ResourceNodePatch {
  progress?: number
  stage?: string
  message?: string
}

export function getResourceId(type: ResourceType, key: string): string {
  return `${type}:${key}`
}

export function createResourceId<TInput>(request: ResourceRequest<TInput>): string {
  return getResourceId(request.type, request.key)
}

export function createResourceNode<TInput, TResult = unknown>(
  request: ResourceRequest<TInput>,
): ResourceNode<TInput, TResult> {
  const now = new Date().toISOString()

  return {
    id: createResourceId(request),
    type: request.type,
    key: request.key,
    input: request.input,
    status: 'idle',
    deps: [],
    dependents: [],
    bindings: [...(request.bindings ?? [])],
    policy: request.policy ?? {},
    attempt: 0,
    createdAt: now,
    updatedAt: now,
  }
}
