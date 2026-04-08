import type { TransitionShaderResource } from '@/core/transition/types'

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

export interface TransitionTemplateDetail extends TransitionTemplateSummary {
  shader: TransitionShaderResource
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
