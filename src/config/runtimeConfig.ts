const trimTrailingSlashes = (value: string): string => value.replace(/\/+$/, '')

function readEnv(name: keyof ImportMetaEnv): string {
  const value = import.meta.env[name]
  return typeof value === 'string' ? value.trim() : ''
}

export const API_BASE_URL = trimTrailingSlashes(readEnv('VITE_API_BASE_URL'))
export const ASSET_BASE_URL = trimTrailingSlashes(readEnv('VITE_ASSET_BASE_URL'))
export const MODEL_MANIFEST_URL = readEnv('VITE_MODEL_MANIFEST_URL')
export const ENABLE_ORT_CDN_FALLBACK = readEnv('VITE_ENABLE_ORT_CDN_FALLBACK') === 'true'

function getAppBaseUrl(): string {
  const base = import.meta.env.BASE_URL || '/'
  return new URL(base, globalThis.location?.origin ?? 'http://localhost').toString()
}

/** Resolve an immutable public asset path against the configured R2 origin. */
export function resolveAssetUrl(path: string): string {
  if (/^https?:\/\//i.test(path)) {
    return path
  }

  const relativePath = path.replace(/^\/+/, '')
  const baseUrl = ASSET_BASE_URL ? `${ASSET_BASE_URL}/` : getAppBaseUrl()
  return new URL(relativePath, baseUrl).toString()
}

export function resolveModelManifestUrl(): string | undefined {
  return MODEL_MANIFEST_URL ? resolveAssetUrl(MODEL_MANIFEST_URL) : undefined
}
