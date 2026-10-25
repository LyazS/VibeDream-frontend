import { AI_TASK_TYPES, type AiTaskType } from '@/core/ai-tasks/types'

export type ApiCapability =
  | 'auth'
  | 'account'
  | 'media'
  | 'agent'
  | 'admin'
  | 'item-properties'
  | 'other'
  | 'ai-tasks'
  | AiTaskType

const capabilityPrefixes: readonly [string, ApiCapability][] = [
  ['/api/auth/', 'auth'],
  ['/api/users/', 'account'],
  ['/api/balance', 'account'],
  ['/api/activation-code', 'account'],
  ['/api/admin/', 'admin'],
  ['/api/media/', 'media'],
  ['/api/agent/', 'agent'],
  ['/api/ai/tasks', 'ai-tasks'],
]

function readEnabledCapabilities(): ReadonlySet<ApiCapability> {
  const raw = import.meta.env.VITE_API_CAPABILITIES ?? ''
  return new Set(
    raw
      .split(',')
      .map((value) => value.trim())
      .filter((value): value is ApiCapability =>
        [
          'auth',
          'account',
          'media',
          'agent',
          'admin',
          'item-properties',
          'other',
          'ai-tasks',
          ...AI_TASK_TYPES,
        ].includes(value),
      ),
  )
}

export const enabledApiCapabilities = readEnabledCapabilities()

export class ApiCapabilityDisabledError extends Error {
  readonly capability: ApiCapability
  readonly path: string

  constructor(path: string, capability: ApiCapability) {
    super(`API 能力暂未开放（${capability}）: ${path}`)
    this.name = 'ApiCapabilityDisabledError'
    this.capability = capability
    this.path = path
  }
}

export function getApiPath(url: string): string | undefined {
  if (url.startsWith('/api/')) {
    return url.split(/[?#]/, 1)[0]
  }

  if (/^https?:\/\//i.test(url)) {
    try {
      const pathname = new URL(url).pathname
      return pathname.startsWith('/api/') ? pathname : undefined
    } catch {
      return undefined
    }
  }

  return undefined
}

export function getApiCapability(path: string, _body?: BodyInit | null): ApiCapability {
  if (path === '/api/providers/dashscope/agent/uploads') return 'agent'
  if (path === '/api/agent/tools/describe-item-property') return 'item-properties'
  if (path === '/api/transitions/test-search') return 'transition.search'
  if (path === '/api/providers/dashscope/uploads/policy') return 'ai-tasks'
  if (path === '/api/media/indexing/reconcile') return 'media.indexing'
  return capabilityPrefixes.find(([prefix]) => path.startsWith(prefix))?.[1] ?? 'other'
}

/** Reject disabled API calls before fetch so unmigrated FastAPI routes are never contacted. */
export function assertApiCapabilityEnabled(url: string, body?: BodyInit | null): void {
  const path = getApiPath(url)
  if (!path) return

  const capability = getApiCapability(path, body)
  if (!enabledApiCapabilities.has(capability)) {
    throw new ApiCapabilityDisabledError(path, capability)
  }
}
