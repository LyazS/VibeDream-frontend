import type { PropertyAnimationGroupId } from '@/core/timelineitem/bunnytype'
import type { AnimatablePropertyId } from '@/core/property-system/mutation/types'
import { normalizeAngle } from '@/core/utils/rotationTransform'

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
