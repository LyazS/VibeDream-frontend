import type { ResourceBinding, ResourceNode, ResourceType } from './ResourceTypes'

export type JobLogPrefix =
  | 'JobRuntime'
  | 'ResourceNode'
  | 'ResourceResolver'
  | 'DagScheduler'
  | 'TaskCenter'
  | 'MediaReady'
  | 'RemoteTask'
  | 'ASRSubtitles'

export type JobLogLevel = 'debug' | 'info' | 'warn' | 'error'

export interface JobLogContext {
  resourceId?: string
  type?: ResourceType
  key?: string
  status?: string
  fromStatus?: string
  toStatus?: string
  stage?: string
  progress?: number
  attempt?: number
  bindings?: ResourceBinding[]
  error?: unknown
  retryable?: boolean
  [key: string]: unknown
}

const PREFIX_MAP: Record<JobLogPrefix, string> = {
  JobRuntime: '[DAG-JobRuntime]',
  ResourceNode: '[DAG-ResourceNode]',
  ResourceResolver: '[DAG-ResourceResolver]',
  DagScheduler: '[DAG-DagScheduler]',
  TaskCenter: '[DAG-TaskCenter]',
  MediaReady: '[DAG-MediaReady]',
  RemoteTask: '[DAG-RemoteTask]',
  ASRSubtitles: '[DAG-ASRSubtitles]',
}

function isDetailedLogEnabled(): boolean {
  if (typeof import.meta !== 'undefined' && import.meta.env?.DEV) {
    return true
  }

  return typeof localStorage !== 'undefined' && localStorage.getItem('DAG_JOB_DEBUG') === 'true'
}

function formatBindings(bindings?: ResourceBinding[]): string | undefined {
  if (!bindings || bindings.length === 0) return undefined
  return bindings.map((binding) => `${binding.type}:${binding.id}`).join(',')
}

function formatError(error: unknown): Record<string, unknown> {
  if (!error) return {}

  if (error instanceof Error) {
    return {
      'error.message': error.message,
      'error.name': error.name,
    }
  }

  if (typeof error === 'object') {
    const maybeError = error as { message?: unknown; code?: unknown; retryable?: unknown }
    return {
      'error.message': typeof maybeError.message === 'string' ? maybeError.message : String(error),
      'error.code': maybeError.code,
      retryable: maybeError.retryable,
    }
  }

  return { 'error.message': String(error) }
}

function formatContext(context: JobLogContext): string {
  const normalized: Record<string, unknown> = {
    resourceId: context.resourceId,
    type: context.type,
    key: context.key,
    status: context.status,
    fromStatus: context.fromStatus,
    toStatus: context.toStatus,
    stage: context.stage,
    progress: context.progress,
    attempt: context.attempt,
    bindings: formatBindings(context.bindings),
    retryable: context.retryable,
    ...formatError(context.error),
  }

  for (const [key, value] of Object.entries(context)) {
    if (key === 'bindings' || key === 'error') continue
    normalized[key] = value
  }

  return Object.entries(normalized)
    .filter(([, value]) => value !== undefined && value !== null && value !== '')
    .map(([key, value]) => `${key}=${String(value)}`)
    .join(' ')
}

function contextFromNode(node: ResourceNode): JobLogContext {
  return {
    resourceId: node.id,
    type: node.type,
    key: node.key,
    status: node.status,
    stage: node.stage,
    progress: node.progress,
    attempt: node.attempt,
    bindings: node.bindings,
  }
}

export const JobLogger = {
  debug(prefix: JobLogPrefix, event: string, context: JobLogContext = {}): void {
    if (!isDetailedLogEnabled()) return
    console.debug(`${PREFIX_MAP[prefix]} ${event} ${formatContext(context)}`)
  },

  info(prefix: JobLogPrefix, event: string, context: JobLogContext = {}): void {
    console.info(`${PREFIX_MAP[prefix]} ${event} ${formatContext(context)}`)
  },

  warn(prefix: JobLogPrefix, event: string, context: JobLogContext = {}): void {
    console.warn(`${PREFIX_MAP[prefix]} ${event} ${formatContext(context)}`)
  },

  error(prefix: JobLogPrefix, event: string, context: JobLogContext = {}): void {
    console.error(`${PREFIX_MAP[prefix]} ${event} ${formatContext(context)}`)
  },

  forNode(node: ResourceNode): JobLogContext {
    return contextFromNode(node)
  },
}
