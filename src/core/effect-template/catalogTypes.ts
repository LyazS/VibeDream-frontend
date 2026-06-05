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

export interface BaseTemplateSummary {
  id: string
  package_version: string
  name: LocalizedText
  summary: LocalizedText
  tags: LocalizedTagList
  cover_url: string | null
  updated_at: string
}

export interface TransitionTemplateSummary extends BaseTemplateSummary {
  duration_frames: number
}

export interface FilterTemplateSummary extends BaseTemplateSummary {
  supported_media_types: Array<'video' | 'image'>
}

export interface EffectTemplatePackageManifestBase {
  apiVersion: '1.0'
  effectType: 'transition' | 'filter'
  packageId: string
  version: string
  name: LocalizedText
  summary: LocalizedText
  tags: LocalizedTagList
  cover: string | null
  entry: string
  parameters: Record<string, unknown>
  sort_order: number
  is_active: boolean
}

export interface TransitionTemplatePackageManifest extends EffectTemplatePackageManifestBase {
  effectType: 'transition'
  host: {
    transition: {
      defaultDurationFrames: number
    }
    filter?: never
  }
}

export interface FilterTemplatePackageManifest extends EffectTemplatePackageManifestBase {
  effectType: 'filter'
  host: {
    transition?: never
    filter: {
      supportedMediaTypes: Array<'video' | 'image'>
    }
  }
}

export type EffectTemplatePackageManifest =
  | TransitionTemplatePackageManifest
  | FilterTemplatePackageManifest

export interface EffectTemplatePackageFile {
  path: string
  content: string
  encoding: 'utf-8' | 'base64'
}

export interface TransitionTemplateDownloadResponse extends TransitionTemplateSummary {
  catalog_version: string
  package_manifest: TransitionTemplatePackageManifest
  package_files: EffectTemplatePackageFile[]
}

export interface FilterTemplateDownloadResponse extends FilterTemplateSummary {
  catalog_version: string
  package_manifest: FilterTemplatePackageManifest
  package_files: EffectTemplatePackageFile[]
}

export interface TransitionTemplateListResponse {
  catalog_version: string
  items: TransitionTemplateSummary[]
}

export interface FilterTemplateListResponse {
  catalog_version: string
  items: FilterTemplateSummary[]
}

export interface CommonEffectCatalog<TItem extends BaseTemplateSummary = BaseTemplateSummary> {
  effectType: 'transition' | 'filter'
  catalogVersion: string
  checkedAt?: string
  items: TItem[]
}

export interface CommonEffectTemplateMeta {
  effectPackageId: string
  effectType: 'transition' | 'filter'
  templateId: string
  packageVersion: string
  catalogVersion: string
  name: LocalizedText
  summary: LocalizedText
  tags: LocalizedTagList
  coverUrl: string
  installedAt: string
  transitionDurationFrames?: number
  supportedMediaTypes?: Array<'video' | 'image'>
}

export interface CommonEffectIndexEntry {
  effectPackageId: string
  effectType: 'transition' | 'filter'
  templateId: string
  packageVersion: string
  catalogVersion: string
  status: 'installed' | 'ready' | 'error' | 'missing'
  packagePath: string
  installedAt?: string
  errorMessage?: string
}

export interface CommonEffectIndexFile {
  version: string
  packages: CommonEffectIndexEntry[]
}
