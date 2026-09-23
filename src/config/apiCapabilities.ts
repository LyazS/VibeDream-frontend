export type ApiCapability =
  | 'auth'
  | 'account'
  | 'media-indexing'
  | 'media'
  | 'agent'
  | 'admin'
  | 'other'

const capabilityPrefixes: readonly [string, ApiCapability][] = [
  ['/api/auth/', 'auth'],
  ['/api/users/', 'account'],
  ['/api/balance', 'account'],
  ['/api/activation-code', 'account'],
  ['/api/admin/', 'admin'],
  ['/api/media/', 'media'],
  ['/api/agent/', 'agent'],
]

function readEnabledCapabilities(): ReadonlySet<ApiCapability> {
  const raw = import.meta.env.VITE_API_CAPABILITIES ?? ''
  return new Set(
    raw
      .split(',')
      .map((value) => value.trim())
      .filter((value): value is ApiCapability =>
        ['auth', 'account', 'media-indexing', 'media', 'agent', 'admin', 'other'].includes(value),
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

export function getApiCapability(path: string): ApiCapability {
  if (path === '/api/media/upload-policies' || path === '/api/media/tasks/indexing') {
    return 'media-indexing'
  }
  if (
    /^\/api\/media\/tasks\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}(?:\/(?:cancel|retry|result))?$/i.test(
      path,
    )
  ) {
    return 'media-indexing'
  }
  return capabilityPrefixes.find(([prefix]) => path.startsWith(prefix))?.[1] ?? 'other'
}

/** Reject disabled API calls before fetch so unmigrated FastAPI routes are never contacted. */
export function assertApiCapabilityEnabled(url: string): void {
  const path = getApiPath(url)
  if (!path) return

  const capability = getApiCapability(path)
  if (!enabledApiCapabilities.has(capability)) {
    throw new ApiCapabilityDisabledError(path, capability)
  }
}
