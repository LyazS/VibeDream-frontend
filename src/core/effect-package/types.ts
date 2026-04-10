import type { LocalizedTagList, LocalizedText } from '@/core/effect-template/catalogTypes'

export type EffectPackageParameterType = 'number' | 'boolean' | 'color' | 'vec2'

export interface EffectPackageParameterDefinition {
  type: EffectPackageParameterType
  default?: unknown
  min?: number
  max?: number
  step?: number
}

export interface EffectPackageManifestSnapshot {
  name: LocalizedText
  summary: LocalizedText
  tags: LocalizedTagList
  cover?: string | null
}

export interface EffectPackageManifest {
  apiVersion: '1.0'
  effectType: 'transition'
  packageId: string
  version: string
  name: LocalizedText
  summary: LocalizedText
  tags: LocalizedTagList
  cover?: string | null
  entry: string
  defaultDurationFrames: number
  parameters: Record<string, EffectPackageParameterDefinition>
  sort_order: number
  is_active: boolean
}

export interface TransitionPackagePayload {
  packageDir: string
  packageId: string
  version: string
  entryFile: string
  defaultDurationFrames: number
  parameterSchema: Record<string, EffectPackageParameterDefinition>
  defaultParams: Record<string, unknown>
  manifestSnapshot: EffectPackageManifestSnapshot
  scriptHash: string
}

export interface LoadedEffectPackage {
  assetId: string
  packageDir: string
  manifest: EffectPackageManifest
  entrySource: string
  textResourcePaths: Map<string, string>
  textResources: Map<string, string>
  pendingTextLoads: Map<string, Promise<string>>
  textureResourcePaths: Map<string, string>
  textureResources: Map<string, ImageBitmap>
  pendingTextureLoads: Map<string, Promise<ImageBitmap>>
  payload: TransitionPackagePayload
}
