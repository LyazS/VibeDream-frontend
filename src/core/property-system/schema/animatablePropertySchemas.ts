import type { PropertyAnimationGroupId } from '@/core/timelineitem/bunnytype'
import type { AnimatablePropertyId } from '@/core/property-system/mutation/types'
import { normalizeAngle } from '@/core/utils/rotationTransform'

export type AnimatablePropertyTarget = 'config' | 'filterEffect' | 'maskConfig'
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

export const transformRotationSchema: AnimatablePropertySchema = {
  propertyId: 'transform.rotation',
  animationGroupId: 'transform.rotation',
  target: 'config',
  valueFields: ['rotation'],
  valueKind: 'number',
  supportsDirectCommit: true,
  supportsKeyframeToggle: true,
  supportsTransientOverlay: true,
  normalizeDirectValue: (value) => ({
    rotation: normalizeAngle(assertFiniteNumber(value, 'transform.rotation')),
  }),
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
  normalizeDirectValue: (value) =>
    assertFiniteNumberRecord(value, ['x', 'y'], 'transform.position'),
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
  normalizeDirectValue: (value) =>
    assertFiniteNumberRecord(value, ['width', 'height'], 'transform.size'),
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
  normalizeDirectValue: (value) => ({
    opacity: clamp(assertFiniteNumber(value, 'transform.opacity'), 0, 1),
  }),
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
  normalizeDirectValue: (value) => ({
    intensity: clamp(assertFiniteNumber(value, 'filter.intensity'), 0, 1),
  }),
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
  normalizeDirectValue: (value) => ({
    volume: clamp(assertFiniteNumber(value, 'audio.volume'), 0, 1),
  }),
}

export const maskCenterSchema: AnimatablePropertySchema = {
  propertyId: 'mask.center',
  animationGroupId: 'mask.center',
  target: 'maskConfig',
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
  target: 'maskConfig',
  valueFields: ['width', 'height'],
  valueKind: 'vec2',
  supportsDirectCommit: true,
  supportsKeyframeToggle: true,
  supportsTransientOverlay: true,
  normalizeDirectValue: (value) =>
    assertFiniteNumberRecord(value, ['width', 'height'], 'mask.rectangle.size'),
}

export const maskEllipseSizeSchema: AnimatablePropertySchema = {
  propertyId: 'mask.ellipse.size',
  animationGroupId: 'mask.ellipse.size',
  target: 'maskConfig',
  valueFields: ['ellipseWidth', 'ellipseHeight'],
  valueKind: 'vec2',
  supportsDirectCommit: true,
  supportsKeyframeToggle: true,
  supportsTransientOverlay: true,
  normalizeDirectValue: (value) =>
    assertFiniteNumberRecord(value, ['ellipseWidth', 'ellipseHeight'], 'mask.ellipse.size'),
}

export const maskRectangleCornerRadiusSchema: AnimatablePropertySchema = {
  propertyId: 'mask.rectangle.cornerRadius',
  animationGroupId: 'mask.rectangle.cornerRadius',
  target: 'maskConfig',
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
  target: 'maskConfig',
  valueFields: ['outerRange'],
  valueKind: 'number',
  supportsDirectCommit: true,
  supportsKeyframeToggle: true,
  supportsTransientOverlay: true,
  normalizeDirectValue: (value) => ({
    outerRange: assertFiniteNumber(value, 'mask.feather'),
  }),
}

export const maskIntensitySchema: AnimatablePropertySchema = {
  propertyId: 'mask.intensity',
  animationGroupId: 'mask.intensity',
  target: 'maskConfig',
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
  target: 'maskConfig',
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
  target: 'maskConfig',
  valueFields: ['length'],
  valueKind: 'number',
  supportsDirectCommit: true,
  supportsKeyframeToggle: true,
  supportsTransientOverlay: true,
  normalizeDirectValue: (value) => ({
    length: Math.max(0, assertFiniteNumber(value, 'mask.mirror.length')),
  }),
}
