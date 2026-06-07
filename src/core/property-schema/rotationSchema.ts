import type { AnimationGroupId } from '@/core/timelineitem/bunnytype'
import type { ClipPropertyId } from '@/core/property-mutation/types'

export interface ClipPropertySchema {
  propertyId: ClipPropertyId
  animationGroupId: AnimationGroupId
  valueFields: readonly string[]
  supportsDirectCommit: boolean
  supportsKeyframeToggle: boolean
  supportsTransientOverlay: boolean
}

export const transformRotationSchema: ClipPropertySchema = {
  propertyId: 'transform.rotation',
  animationGroupId: 'transform.rotation',
  valueFields: ['rotation'],
  supportsDirectCommit: true,
  supportsKeyframeToggle: true,
  supportsTransientOverlay: true,
}

export const transformPositionSchema: ClipPropertySchema = {
  propertyId: 'transform.position',
  animationGroupId: 'transform.position',
  valueFields: ['x', 'y'],
  supportsDirectCommit: true,
  supportsKeyframeToggle: true,
  supportsTransientOverlay: false,
}

export const transformSizeSchema: ClipPropertySchema = {
  propertyId: 'transform.size',
  animationGroupId: 'transform.size',
  valueFields: ['width', 'height'],
  supportsDirectCommit: true,
  supportsKeyframeToggle: true,
  supportsTransientOverlay: false,
}
