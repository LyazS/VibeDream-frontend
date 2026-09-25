/// <reference types="vite/client" />

declare module '*.vert?raw' {
  const source: string
  export default source
}

declare module '*.frag?raw' {
  const source: string
  export default source
}

interface ImportMetaEnv {
  readonly VITE_API_BASE_URL?: string
  readonly VITE_API_CAPABILITIES?: string
  readonly VITE_ASSET_BASE_URL?: string
  readonly VITE_TRANSITION_ASSET_BASE_URL?: string
  readonly VITE_MODEL_MANIFEST_URL?: string
  readonly VITE_ENABLE_ORT_CDN_FALLBACK?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
