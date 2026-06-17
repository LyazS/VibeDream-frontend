import type { PropertyAnimationGroupId } from '@/core/timelineitem/bunnytype'
import type { DirectPropertyId } from '@/core/property-system/mutation/types'
import { normalizeAngle } from '@/core/utils/rotationTransform'

export type AnimatablePropertyTarget = 'config' | 'mask' | 'filter'
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
  normalizeDirectValue: (value) =>
    assertFiniteNumberRecord(value, ['width', 'height'], 'mask.rectangle.size'),
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
  normalizeDirectValue: (value) =>
    assertFiniteNumberRecord(value, ['ellipseWidth', 'ellipseHeight'], 'mask.ellipse.size'),
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
    outerRange: assertFiniteNumber(value, 'mask.feather'),
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

export const textContentSchema: AnimatablePropertySchema = {
  propertyId: 'text.content',
  target: 'config',
  valueFields: ['text'],
  valueKind: 'boolean',
  supportsDirectCommit: true,
  supportsKeyframeToggle: false,
  supportsTransientOverlay: false,
  normalizeDirectValue: (value) => {
    if (typeof value !== 'string') {
      throw new Error('text.content requires a string value')
    }

    const text = value.trim()
    if (!text) {
      throw new Error('text.content requires a non-empty string value')
    }

    return { text }
  },
}

export const textStyleFontSizeSchema: AnimatablePropertySchema = {
  propertyId: 'text.style.fontSize',
  target: 'config',
  valueFields: ['fontSize'],
  valueKind: 'number',
  supportsDirectCommit: true,
  supportsKeyframeToggle: false,
  supportsTransientOverlay: false,
  min: 12,
  max: 200,
  step: 1,
  normalizeDirectValue: (value) => ({
    fontSize: clamp(assertFiniteNumber(value, 'text.style.fontSize'), 12, 200),
  }),
}

export const textStyleFontFamilySchema: AnimatablePropertySchema = {
  propertyId: 'text.style.fontFamily',
  target: 'config',
  valueFields: ['fontFamily'],
  valueKind: 'boolean',
  supportsDirectCommit: true,
  supportsKeyframeToggle: false,
  supportsTransientOverlay: false,
  normalizeDirectValue: (value) => {
    if (typeof value !== 'string') {
      throw new Error('text.style.fontFamily requires a string value')
    }

    const fontFamily = value.trim()
    if (!fontFamily) {
      throw new Error('text.style.fontFamily requires a non-empty string value')
    }

    return { fontFamily }
  },
}

export const textStyleFontWeightSchema: AnimatablePropertySchema = {
  propertyId: 'text.style.fontWeight',
  target: 'config',
  valueFields: ['fontWeight'],
  valueKind: 'boolean',
  supportsDirectCommit: true,
  supportsKeyframeToggle: false,
  supportsTransientOverlay: false,
  normalizeDirectValue: (value) => {
    if (typeof value !== 'string' && typeof value !== 'number') {
      throw new Error('text.style.fontWeight requires a string or number value')
    }

    return { fontWeight: value }
  },
}

export const textStyleFontStyleSchema: AnimatablePropertySchema = {
  propertyId: 'text.style.fontStyle',
  target: 'config',
  valueFields: ['fontStyle'],
  valueKind: 'boolean',
  supportsDirectCommit: true,
  supportsKeyframeToggle: false,
  supportsTransientOverlay: false,
  normalizeDirectValue: (value) => {
    if (value !== 'normal' && value !== 'italic') {
      throw new Error('text.style.fontStyle requires "normal" or "italic"')
    }

    return { fontStyle: value }
  },
}

export const textStyleColorSchema: AnimatablePropertySchema = {
  propertyId: 'text.style.color',
  target: 'config',
  valueFields: ['color'],
  valueKind: 'color',
  supportsDirectCommit: true,
  supportsKeyframeToggle: false,
  supportsTransientOverlay: false,
  normalizeDirectValue: (value) => {
    if (typeof value !== 'string') {
      throw new Error('text.style.color requires a string value')
    }

    const color = value.trim()
    if (!color) {
      throw new Error('text.style.color requires a non-empty string value')
    }

    return { color }
  },
}

export const textStyleBackgroundColorSchema: AnimatablePropertySchema = {
  propertyId: 'text.style.backgroundColor',
  target: 'config',
  valueFields: ['backgroundColor'],
  valueKind: 'color',
  supportsDirectCommit: true,
  supportsKeyframeToggle: false,
  supportsTransientOverlay: false,
  normalizeDirectValue: (value) => {
    if (typeof value === 'undefined') {
      return { backgroundColor: undefined }
    }

    if (typeof value !== 'string') {
      throw new Error('text.style.backgroundColor requires a string value or undefined')
    }

    const backgroundColor = value.trim()
    if (!backgroundColor) {
      throw new Error('text.style.backgroundColor requires a non-empty string value')
    }

    return { backgroundColor }
  },
}

export const textStyleTextAlignSchema: AnimatablePropertySchema = {
  propertyId: 'text.style.textAlign',
  target: 'config',
  valueFields: ['textAlign'],
  valueKind: 'boolean',
  supportsDirectCommit: true,
  supportsKeyframeToggle: false,
  supportsTransientOverlay: false,
  normalizeDirectValue: (value) => {
    if (value !== 'left' && value !== 'center' && value !== 'right') {
      throw new Error('text.style.textAlign requires "left", "center", or "right"')
    }

    return { textAlign: value }
  },
}

export const textStyleTextShadowSchema: AnimatablePropertySchema = {
  propertyId: 'text.style.textShadow',
  target: 'config',
  valueFields: ['textShadow'],
  valueKind: 'boolean',
  supportsDirectCommit: true,
  supportsKeyframeToggle: false,
  supportsTransientOverlay: false,
  normalizeDirectValue: (value) => {
    if (typeof value === 'undefined') {
      return { textShadow: undefined }
    }

    if (typeof value !== 'string') {
      throw new Error('text.style.textShadow requires a string value or undefined')
    }

    const textShadow = value.trim()
    if (!textShadow) {
      throw new Error('text.style.textShadow requires a non-empty string value')
    }

    return { textShadow }
  },
}

export const textStyleTextStrokeSchema: AnimatablePropertySchema = {
  propertyId: 'text.style.textStroke',
  target: 'config',
  valueFields: ['textStroke'],
  valueKind: 'boolean',
  supportsDirectCommit: true,
  supportsKeyframeToggle: false,
  supportsTransientOverlay: false,
  normalizeDirectValue: (value) => {
    if (typeof value === 'undefined') {
      return { textStroke: undefined }
    }

    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      throw new Error('text.style.textStroke requires an object value or undefined')
    }

    const { width, color } = value as { width?: unknown; color?: unknown }
    if (typeof width !== 'number' || !Number.isFinite(width)) {
      throw new Error('text.style.textStroke requires a finite width')
    }
    if (typeof color !== 'string' || !color.trim()) {
      throw new Error('text.style.textStroke requires a non-empty color')
    }

    return {
      textStroke: {
        width: clamp(width, 0, 10),
        color: color.trim(),
      },
    }
  },
}

export const textStyleTextGlowSchema: AnimatablePropertySchema = {
  propertyId: 'text.style.textGlow',
  target: 'config',
  valueFields: ['textGlow'],
  valueKind: 'boolean',
  supportsDirectCommit: true,
  supportsKeyframeToggle: false,
  supportsTransientOverlay: false,
  normalizeDirectValue: (value) => {
    if (typeof value === 'undefined') {
      return { textGlow: undefined }
    }

    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      throw new Error('text.style.textGlow requires an object value or undefined')
    }

    const { color, blur, spread } = value as {
      color?: unknown
      blur?: unknown
      spread?: unknown
    }
    if (typeof color !== 'string' || !color.trim()) {
      throw new Error('text.style.textGlow requires a non-empty color')
    }
    if (typeof blur !== 'number' || !Number.isFinite(blur)) {
      throw new Error('text.style.textGlow requires a finite blur')
    }
    if (typeof spread !== 'undefined' && (typeof spread !== 'number' || !Number.isFinite(spread))) {
      throw new Error('text.style.textGlow requires a finite spread when provided')
    }

    return {
      textGlow: {
        color: color.trim(),
        blur: clamp(blur, 1, 30),
        spread: typeof spread === 'number' ? clamp(spread, 0, 20) : undefined,
      },
    }
  },
}
