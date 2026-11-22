import type { PropertyAnimationGroupId } from '@/core/timelineitem/model/render'
import type { DirectPropertyId } from '@/core/property-system/mutation/types'

export type AnimatablePropertyTarget = 'visual' | 'audio' | 'mask' | 'filter'
export type PropertyValueKind = 'number' | 'boolean' | 'color' | 'vec2'

export interface AnimatablePropertySchema {
  propertyId: DirectPropertyId
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
  normalizeDirectValue: (value: unknown) => Record<string, unknown>
  normalizeKeyframeValue?: (value: unknown) => Record<string, unknown>
}

function assertFiniteNumber(value: unknown, propertyId: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`${propertyId} requires a finite numeric value`)
  }
  return value
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

function assertFiniteNumberRecord(
  value: unknown,
  allowedFields: readonly string[],
  propertyId: string,
): Record<string, number> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${propertyId} requires finite numeric patch values`)
  }

  const entries = Object.entries(value)
  if (
    entries.length === 0 ||
    !entries.every(([key, entryValue]) => allowedFields.includes(key) && Number.isFinite(entryValue))
  ) {
    throw new Error(`${propertyId} requires finite numeric patch values`)
  }

  return value as Record<string, number>
}

export const visualRotationSchema: AnimatablePropertySchema = {
  propertyId: 'visual.rotation',
  animationGroupId: 'visual.rotation',
  target: 'visual',
  valueFields: ['rotation'],
  valueKind: 'number',
  supportsDirectCommit: true,
  supportsKeyframeToggle: true,
  supportsTransientOverlay: true,
  normalizeDirectValue: (value) => ({
    rotation: assertFiniteNumber(value, 'visual.rotation'),
  }),
}

export const visualPositionSchema: AnimatablePropertySchema = {
  propertyId: 'visual.position',
  animationGroupId: 'visual.position',
  target: 'visual',
  valueFields: ['x', 'y'],
  valueKind: 'vec2',
  supportsDirectCommit: true,
  supportsKeyframeToggle: true,
  supportsTransientOverlay: true,
  normalizeDirectValue: (value) =>
    assertFiniteNumberRecord(value, ['x', 'y'], 'visual.position'),
}

export const visualSizeSchema: AnimatablePropertySchema = {
  propertyId: 'visual.size',
  animationGroupId: 'visual.size',
  target: 'visual',
  valueFields: ['width', 'height'],
  valueKind: 'vec2',
  supportsDirectCommit: true,
  supportsKeyframeToggle: true,
  supportsTransientOverlay: true,
  normalizeDirectValue: (value) =>
    assertFiniteNumberRecord(value, ['width', 'height'], 'visual.size'),
}

export const visualBlendIntensitySchema: AnimatablePropertySchema = {
  propertyId: 'visual.blendIntensity',
  animationGroupId: 'visual.blendIntensity',
  target: 'visual',
  valueFields: ['blendIntensity'],
  valueKind: 'number',
  supportsDirectCommit: true,
  supportsKeyframeToggle: true,
  supportsTransientOverlay: true,
  normalizeDirectValue: (value) => ({
    blendIntensity: clamp(assertFiniteNumber(value, 'visual.blendIntensity'), 0, 1),
  }),
}

export const filterIntensitySchema: AnimatablePropertySchema = {
  propertyId: 'filter.intensity',
  animationGroupId: 'filter.intensity',
  target: 'filter',
  valueFields: ['intensity'],
  valueKind: 'number',
  supportsDirectCommit: true,
  supportsKeyframeToggle: true,
  supportsTransientOverlay: true,
  normalizeDirectValue: (value) => ({
    intensity: clamp(assertFiniteNumber(value, 'filter.intensity'), 0, 1),
  }),
}

export const audioVolumeSchema: AnimatablePropertySchema = {
  propertyId: 'audio.volume',
  animationGroupId: 'audio.volume',
  target: 'audio',
  valueFields: ['volume'],
  valueKind: 'number',
  supportsDirectCommit: true,
  supportsKeyframeToggle: true,
  supportsTransientOverlay: true,
  normalizeDirectValue: (value) => ({
    volume: clamp(assertFiniteNumber(value, 'audio.volume'), 0, 1),
  }),
}

export const maskCenterSchema: AnimatablePropertySchema = {
  propertyId: 'mask.center',
  animationGroupId: 'mask.center',
  target: 'mask',
  valueFields: ['centerX', 'centerY'],
  valueKind: 'vec2',
  supportsDirectCommit: true,
  supportsKeyframeToggle: true,
  supportsTransientOverlay: true,
  normalizeDirectValue: (value) =>
    assertFiniteNumberRecord(value, ['centerX', 'centerY'], 'mask.center'),
}

export const maskRectangleSizeSchema: AnimatablePropertySchema = {
  propertyId: 'mask.rectangle.size',
  animationGroupId: 'mask.rectangle.size',
  target: 'mask',
  valueFields: ['width', 'height'],
  valueKind: 'vec2',
  supportsDirectCommit: true,
  supportsKeyframeToggle: true,
  supportsTransientOverlay: true,
  normalizeDirectValue: (value) => {
    const normalized = assertFiniteNumberRecord(value, ['width', 'height'], 'mask.rectangle.size')
    return { width: Math.max(0, normalized.width), height: Math.max(0, normalized.height) }
  },
}

export const maskEllipseSizeSchema: AnimatablePropertySchema = {
  propertyId: 'mask.ellipse.size',
  animationGroupId: 'mask.ellipse.size',
  target: 'mask',
  valueFields: ['ellipseWidth', 'ellipseHeight'],
  valueKind: 'vec2',
  supportsDirectCommit: true,
  supportsKeyframeToggle: true,
  supportsTransientOverlay: true,
  normalizeDirectValue: (value) => {
    const normalized = assertFiniteNumberRecord(value, ['ellipseWidth', 'ellipseHeight'], 'mask.ellipse.size')
    return {
      ellipseWidth: Math.max(0, normalized.ellipseWidth),
      ellipseHeight: Math.max(0, normalized.ellipseHeight),
    }
  },
}

export const maskRectangleCornerRadiusSchema: AnimatablePropertySchema = {
  propertyId: 'mask.rectangle.cornerRadius',
  animationGroupId: 'mask.rectangle.cornerRadius',
  target: 'mask',
  valueFields: ['cornerRadius'],
  valueKind: 'number',
  supportsDirectCommit: true,
  supportsKeyframeToggle: true,
  supportsTransientOverlay: true,
  normalizeDirectValue: (value) => ({
    cornerRadius: clamp(assertFiniteNumber(value, 'mask.rectangle.cornerRadius'), 0, 1),
  }),
}

export const maskFeatherSchema: AnimatablePropertySchema = {
  propertyId: 'mask.feather',
  animationGroupId: 'mask.feather',
  target: 'mask',
  valueFields: ['outerRange'],
  valueKind: 'number',
  supportsDirectCommit: true,
  supportsKeyframeToggle: true,
  supportsTransientOverlay: true,
  normalizeDirectValue: (value) => ({
    outerRange: Math.max(0, assertFiniteNumber(value, 'mask.feather')),
  }),
}

export const maskIntensitySchema: AnimatablePropertySchema = {
  propertyId: 'mask.intensity',
  animationGroupId: 'mask.intensity',
  target: 'mask',
  valueFields: ['decayRate'],
  valueKind: 'number',
  supportsDirectCommit: true,
  supportsKeyframeToggle: true,
  supportsTransientOverlay: true,
  normalizeDirectValue: (value) => ({
    decayRate: clamp(assertFiniteNumber(value, 'mask.intensity'), 0, 1),
  }),
}

export const maskRotationSchema: AnimatablePropertySchema = {
  propertyId: 'mask.rotation',
  animationGroupId: 'mask.rotation',
  target: 'mask',
  valueFields: ['rotation'],
  valueKind: 'number',
  supportsDirectCommit: true,
  supportsKeyframeToggle: true,
  supportsTransientOverlay: true,
  normalizeDirectValue: (value) => ({
    rotation: assertFiniteNumber(value, 'mask.rotation'),
  }),
}

export const maskMirrorLengthSchema: AnimatablePropertySchema = {
  propertyId: 'mask.mirror.length',
  animationGroupId: 'mask.mirror.length',
  target: 'mask',
  valueFields: ['length'],
  valueKind: 'number',
  supportsDirectCommit: true,
  supportsKeyframeToggle: true,
  supportsTransientOverlay: true,
  normalizeDirectValue: (value) => ({
    length: Math.max(0, assertFiniteNumber(value, 'mask.mirror.length')),
  }),
}
