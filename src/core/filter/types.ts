import type { FilterPackagePayload } from '@/core/effect-package/types'

export const DEFAULT_CLIP_FILTER_INTENSITY = 1

export interface ClipFilterConfig {
  effectPackageId: string
  templateId: string
  packageVersion: string
  catalogVersion: string
  intensity: number
  params: Record<string, unknown>
  packagePayload: FilterPackagePayload
}
