import type { AnimationGroupId } from '@/core/timelineitem/bunnytype'
import type { AnimatablePropertyId } from '@/core/property-system/mutation/types'

export type AnimatablePropertyTarget = 'config' | 'filterEffect'

export interface AnimatablePropertySchema {
  propertyId: AnimatablePropertyId
  animationGroupId: AnimationGroupId
  target: AnimatablePropertyTarget
  valueFields: readonly string[]
  supportsDirectCommit: boolean
  supportsKeyframeToggle: boolean
  supportsTransientOverlay: boolean
}

export const transformRotationSchema: AnimatablePropertySchema = {
  propertyId: 'transform.rotation',
  animationGroupId: 'transform.rotation',
  target: 'config',
  valueFields: ['rotation'],
  supportsDirectCommit: true,
  supportsKeyframeToggle: true,
  supportsTransientOverlay: true,
}

export const transformPositionSchema: AnimatablePropertySchema = {
  propertyId: 'transform.position',
  animationGroupId: 'transform.position',
  target: 'config',
  valueFields: ['x', 'y'],
  supportsDirectCommit: true,
  supportsKeyframeToggle: true,
  supportsTransientOverlay: true,
}

export const transformSizeSchema: AnimatablePropertySchema = {
  propertyId: 'transform.size',
  animationGroupId: 'transform.size',
  target: 'config',
  valueFields: ['width', 'height'],
  supportsDirectCommit: true,
  supportsKeyframeToggle: true,
  supportsTransientOverlay: true,
}

export const transformOpacitySchema: AnimatablePropertySchema = {
  propertyId: 'transform.opacity',
  animationGroupId: 'transform.opacity',
  target: 'config',
  valueFields: ['opacity'],
  supportsDirectCommit: true,
  supportsKeyframeToggle: true,
  supportsTransientOverlay: true,
}

export const filterIntensitySchema: AnimatablePropertySchema = {
  propertyId: 'filter.intensity',
  animationGroupId: 'filter.intensity',
  target: 'filterEffect',
  valueFields: ['intensity'],
  supportsDirectCommit: true,
  supportsKeyframeToggle: true,
  supportsTransientOverlay: true,
}

export const audioVolumeSchema: AnimatablePropertySchema = {
  propertyId: 'audio.volume',
  animationGroupId: 'audio.volume',
  target: 'config',
  valueFields: ['volume'],
  supportsDirectCommit: true,
  supportsKeyframeToggle: true,
  supportsTransientOverlay: true,
}
