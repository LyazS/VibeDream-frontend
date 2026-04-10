export interface LocalizedText {
  zh: string
  en: string
}

export interface LocalizedTagList {
  zh: string[]
  en: string[]
}

export interface TransitionCatalogVersionResponse {
  catalog_version: string
  updated_at: string | null
  total: number
}

export interface TransitionTemplateSummary {
  id: string
  name: LocalizedText
  summary: LocalizedText
  tags: LocalizedTagList
  cover_url: string | null
  duration_frames: number
  updated_at: string
}

export interface TransitionTemplatePackageManifest {
  apiVersion: '1.0'
  effectType: 'transition'
  packageId: string
  version: string
  name: LocalizedText
  summary: LocalizedText
  tags: LocalizedTagList
  cover: string | null
  entry: string
  host: {
    transition: {
      defaultDurationFrames: number
    }
  }
  parameters: Record<string, unknown>
  sort_order: number
  is_active: boolean
}

export interface TransitionTemplatePackageFile {
  path: string
  content: string
  encoding: 'utf-8' | 'base64'
}

export interface TransitionTemplateDownloadResponse extends TransitionTemplateSummary {
  package_manifest: TransitionTemplatePackageManifest
  package_files: TransitionTemplatePackageFile[]
}

export interface TransitionTemplateListResponse {
  catalog_version: string
  items: TransitionTemplateSummary[]
}

export interface TransitionTemplateCatalogCache {
  version: string
  timestamp: number
  items: TransitionTemplateSummary[]
}
