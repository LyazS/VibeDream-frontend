export type ApiCapability = 'auth' | 'account' | 'media' | 'agent' | 'admin' | 'other'

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
        ['auth', 'account', 'media', 'agent', 'admin', 'other'].includes(value),
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
  return capabilityPrefixes.find(([prefix]) => path.startsWith(prefix))?.[1] ?? 'other'
}

/** Reject disabled API calls before fetch so legacy FastAPI is never contacted in phase 1.1. */
export function assertApiCapabilityEnabled(url: string): void {
  const path = getApiPath(url)
  if (!path) return

  const capability = getApiCapability(path)
  if (!enabledApiCapabilities.has(capability)) {
    throw new ApiCapabilityDisabledError(path, capability)
  }
}
