import type { PropertyAnimationGroupId } from '@/core/timelineitem/bunnytype'
import type { AnimatablePropertyId } from '@/core/property-system/mutation/types'

export type AnimatablePropertyTarget = 'config' | 'filterEffect'
export type PropertyValueKind = 'number' | 'boolean' | 'color' | 'vec2'

export interface AnimatablePropertySchema {
  propertyId: AnimatablePropertyId
  animationGroupId?: PropertyAnimationGroupId
  target: AnimatablePropertyTarget
  valueFields: readonly string[]
  valueKind: PropertyValueKind
  supportsDirectCommit: boolean
  supportsKeyframeToggle: boolean
  supportsTransientOverlay: boolean
  label?: string
  min?: number
  max?: number
  step?: number
  normalizeDirectValue?: (value: unknown) => Record<string, unknown>
  normalizeKeyframeValue?: (value: unknown) => Record<string, unknown>
}

export const transformRotationSchema: AnimatablePropertySchema = {
  propertyId: 'transform.rotation',
  animationGroupId: 'transform.rotation',
  target: 'config',
  valueFields: ['rotation'],
  valueKind: 'number',
  supportsDirectCommit: true,
  supportsKeyframeToggle: true,
  supportsTransientOverlay: true,
}

export const transformPositionSchema: AnimatablePropertySchema = {
  propertyId: 'transform.position',
  animationGroupId: 'transform.position',
  target: 'config',
  valueFields: ['x', 'y'],
  valueKind: 'vec2',
  supportsDirectCommit: true,
  supportsKeyframeToggle: true,
  supportsTransientOverlay: true,
}

export const transformSizeSchema: AnimatablePropertySchema = {
  propertyId: 'transform.size',
  animationGroupId: 'transform.size',
  target: 'config',
  valueFields: ['width', 'height'],
  valueKind: 'vec2',
  supportsDirectCommit: true,
  supportsKeyframeToggle: true,
  supportsTransientOverlay: true,
}

export const transformOpacitySchema: AnimatablePropertySchema = {
  propertyId: 'transform.opacity',
  animationGroupId: 'transform.opacity',
  target: 'config',
  valueFields: ['opacity'],
  valueKind: 'number',
  supportsDirectCommit: true,
  supportsKeyframeToggle: true,
  supportsTransientOverlay: true,
}

export const filterIntensitySchema: AnimatablePropertySchema = {
  propertyId: 'filter.intensity',
  animationGroupId: 'filter.intensity',
  target: 'filterEffect',
  valueFields: ['intensity'],
  valueKind: 'number',
  supportsDirectCommit: true,
  supportsKeyframeToggle: true,
  supportsTransientOverlay: true,
}

export const audioVolumeSchema: AnimatablePropertySchema = {
  propertyId: 'audio.volume',
  animationGroupId: 'audio.volume',
  target: 'config',
  valueFields: ['volume'],
  valueKind: 'number',
  supportsDirectCommit: true,
  supportsKeyframeToggle: true,
  supportsTransientOverlay: true,
}
