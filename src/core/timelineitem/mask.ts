export type MaskType = 'rectangle' | 'ellipse' | 'linear' | 'mirror'

export interface MaskTextureSize {
  width: number
  height: number
}

export interface MaskFalloff {
  outerRange: number
  decayRate: number
}

interface BaseMaskConfig {
  enabled: boolean
  type: MaskType
  inverted: boolean
  centerX: number
  centerY: number
  rotation: number
  falloff: MaskFalloff
}

export interface RectangleMaskConfig extends BaseMaskConfig {
  type: 'rectangle'
  width: number
  height: number
  cornerRadius: number
}

export interface EllipseMaskConfig extends BaseMaskConfig {
  type: 'ellipse'
  ellipseWidth: number
  ellipseHeight: number
}

export interface LinearMaskConfig extends BaseMaskConfig {
  type: 'linear'
}

export interface MirrorMaskConfig extends BaseMaskConfig {
  type: 'mirror'
  length: number
}

export type MaskConfig =
  | RectangleMaskConfig
  | EllipseMaskConfig
  | LinearMaskConfig
  | MirrorMaskConfig

interface LegacyMaskShape {
  centerX?: number
  centerY?: number
  rotation?: number
  width?: number
  height?: number
  ellipseWidth?: number
  ellipseHeight?: number
  cornerRadius?: number
  length?: number
}

export interface MaskConfigPatch {
  enabled?: boolean
  type?: MaskType
  inverted?: boolean
  centerX?: number
  centerY?: number
  rotation?: number
  width?: number
  height?: number
  ellipseWidth?: number
  ellipseHeight?: number
  cornerRadius?: number
  length?: number
  falloff?: Partial<MaskFalloff> | null
  shape?: LegacyMaskShape | null
}

export interface MaskAnimatableProps {
  'mask.centerX': number
  'mask.centerY': number
  'mask.rotation': number
  'mask.width': number
  'mask.height': number
  'mask.ellipseWidth': number
  'mask.ellipseHeight': number
  'mask.cornerRadius': number
  'mask.length': number
  'mask.outerRange': number
  'mask.decayRate': number
}

export interface MaskCenterAnimatableProps {
  'mask.centerX': number
  'mask.centerY': number
}

export interface MaskRotationAnimatableProps {
  'mask.rotation': number
}

export interface MaskOuterRangeAnimatableProps {
  'mask.outerRange': number
}

export interface MaskDecayRateAnimatableProps {
  'mask.decayRate': number
}

export interface MaskShapeAnimatableProps {
  'mask.width': number
  'mask.height': number
  'mask.ellipseWidth': number
  'mask.ellipseHeight': number
  'mask.cornerRadius': number
  'mask.length': number
}

export interface MaskRectangleSizeAnimatableProps {
  'mask.width': number
  'mask.height': number
}

export interface MaskRectangleCornerAnimatableProps {
  'mask.cornerRadius': number
}

export interface MaskEllipseSizeAnimatableProps {
  'mask.ellipseWidth': number
  'mask.ellipseHeight': number
}

export interface MaskMirrorLengthAnimatableProps {
  'mask.length': number
}

export type MaskPropertyPath = keyof MaskAnimatableProps

export const MASK_ANIMATABLE_PATHS = [
  'mask.centerX',
  'mask.centerY',
  'mask.rotation',
  'mask.width',
  'mask.height',
  'mask.ellipseWidth',
  'mask.ellipseHeight',
  'mask.cornerRadius',
  'mask.length',
  'mask.outerRange',
  'mask.decayRate',
] as const satisfies readonly MaskPropertyPath[]

export const MASK_CENTER_PATHS = [
  'mask.centerX',
  'mask.centerY',
] as const satisfies readonly (keyof MaskCenterAnimatableProps)[]
export const MASK_ROTATION_PATHS = [
  'mask.rotation',
] as const satisfies readonly (keyof MaskRotationAnimatableProps)[]
export const MASK_OUTER_RANGE_PATHS = [
  'mask.outerRange',
] as const satisfies readonly (keyof MaskOuterRangeAnimatableProps)[]
export const MASK_DECAY_RATE_PATHS = [
  'mask.decayRate',
] as const satisfies readonly (keyof MaskDecayRateAnimatableProps)[]
export const MASK_SHAPE_PATHS = [
  'mask.width',
  'mask.height',
  'mask.ellipseWidth',
  'mask.ellipseHeight',
  'mask.cornerRadius',
  'mask.length',
] as const satisfies readonly (keyof MaskShapeAnimatableProps)[]

export const MASK_RECTANGLE_SIZE_PATHS = [
  'mask.width',
  'mask.height',
] as const satisfies readonly (keyof MaskRectangleSizeAnimatableProps)[]

export const MASK_RECTANGLE_CORNER_PATHS = [
  'mask.cornerRadius',
] as const satisfies readonly (keyof MaskRectangleCornerAnimatableProps)[]

export const MASK_ELLIPSE_SIZE_PATHS = [
  'mask.ellipseWidth',
  'mask.ellipseHeight',
] as const satisfies readonly (keyof MaskEllipseSizeAnimatableProps)[]

export const MASK_MIRROR_LENGTH_PATHS = [
  'mask.length',
] as const satisfies readonly (keyof MaskMirrorLengthAnimatableProps)[]

const DEFAULT_MASK_TEXTURE_SIZE: MaskTextureSize = {
  width: 1920,
  height: 1080,
}

function normalizeMaskType(type: unknown): MaskType {
  if (type === 'rectangle' || type === 'ellipse' || type === 'linear' || type === 'mirror') {
    return type
  }

  return 'rectangle'
}

function sanitizeMaskTextureSize(textureSize?: Partial<MaskTextureSize> | null): MaskTextureSize {
  const width = textureSize?.width ?? DEFAULT_MASK_TEXTURE_SIZE.width
  const height = textureSize?.height ?? DEFAULT_MASK_TEXTURE_SIZE.height

  return {
    width: Number.isFinite(width) && width > 0 ? width : DEFAULT_MASK_TEXTURE_SIZE.width,
    height: Number.isFinite(height) && height > 0 ? height : DEFAULT_MASK_TEXTURE_SIZE.height,
  }
}

function pickNumericValue(...values: unknown[]): number | undefined {
  for (const value of values) {
    if (typeof value === 'number' && Number.isFinite(value)) {
      return value
    }
  }

  return undefined
}

function createDefaultFalloff(textureSize?: Partial<MaskTextureSize> | null): MaskFalloff {
  const safeSize = sanitizeMaskTextureSize(textureSize)
  const defaultFeather = Math.min(safeSize.width, safeSize.height) * 0.1
  return {
    outerRange: defaultFeather,
    decayRate: 1,
  }
}

function createBaseMaskDefaults(
  type: MaskType,
  textureSize?: Partial<MaskTextureSize> | null,
): BaseMaskConfig {
  return {
    enabled: false,
    type,
    inverted: false,
    centerX: 0,
    centerY: 0,
    rotation: 0,
    falloff: createDefaultFalloff(textureSize),
  }
}

function createTypeDefaults(
  type: MaskType,
  textureSize?: Partial<MaskTextureSize> | null,
): RectangleMaskConfig | EllipseMaskConfig | LinearMaskConfig | MirrorMaskConfig {
  const safeSize = sanitizeMaskTextureSize(textureSize)
  const base = createBaseMaskDefaults(type, textureSize)

  switch (type) {
    case 'rectangle':
      return {
        ...base,
        type,
        width: safeSize.width * 0.6,
        height: safeSize.height * 0.6,
        cornerRadius: 0,
      }
    case 'ellipse':
      return {
        ...base,
        type,
        ellipseWidth: safeSize.width * 0.6,
        ellipseHeight: safeSize.height * 0.4,
      }
    case 'linear':
      return {
        ...base,
        type,
      }
    case 'mirror':
      return {
        ...base,
        type,
        length: safeSize.width * 0.6,
      }
  }
}

export function isRectangleMaskConfig(mask: MaskConfig): mask is RectangleMaskConfig {
  return mask.type === 'rectangle'
}

export function isEllipseMaskConfig(mask: MaskConfig): mask is EllipseMaskConfig {
  return mask.type === 'ellipse'
}

export function isLinearMaskConfig(mask: MaskConfig): mask is LinearMaskConfig {
  return mask.type === 'linear'
}

export function isMirrorMaskConfig(mask: MaskConfig): mask is MirrorMaskConfig {
  return mask.type === 'mirror'
}

export function getItemLocalSize(width: number, height: number): MaskTextureSize {
  return sanitizeMaskTextureSize({ width, height })
}

export function createDefaultMaskConfig(
  type: MaskType = 'rectangle',
  textureSize?: Partial<MaskTextureSize> | null,
): MaskConfig {
  return createTypeDefaults(type, textureSize)
}

export function normalizeMaskConfig(
  mask?: MaskConfigPatch | Partial<MaskConfig> | null,
  textureSize?: Partial<MaskTextureSize> | null,
): MaskConfig {
  const patch = (mask ?? {}) as MaskConfigPatch
  const type = normalizeMaskType(patch.type)
  const defaults = createTypeDefaults(type, textureSize)
  const legacyShape = patch.shape

  const base = {
    enabled: patch.enabled ?? defaults.enabled,
    type,
    inverted: patch.inverted ?? defaults.inverted,
    centerX: pickNumericValue(patch.centerX, legacyShape?.centerX, defaults.centerX) ?? defaults.centerX,
    centerY: pickNumericValue(patch.centerY, legacyShape?.centerY, defaults.centerY) ?? defaults.centerY,
    rotation:
      pickNumericValue(patch.rotation, legacyShape?.rotation, defaults.rotation) ?? defaults.rotation,
    falloff: {
      outerRange:
        pickNumericValue(patch.falloff?.outerRange, defaults.falloff.outerRange) ??
        defaults.falloff.outerRange,
      decayRate:
        pickNumericValue(patch.falloff?.decayRate, defaults.falloff.decayRate) ??
        defaults.falloff.decayRate,
    },
  } as const

  switch (type) {
    case 'rectangle': {
      const rectangleDefaults = defaults as RectangleMaskConfig
      return {
        ...base,
        type,
        width:
          pickNumericValue(patch.width, legacyShape?.width, rectangleDefaults.width) ??
          rectangleDefaults.width,
        height:
          pickNumericValue(patch.height, legacyShape?.height, rectangleDefaults.height) ??
          rectangleDefaults.height,
        cornerRadius:
          pickNumericValue(
            patch.cornerRadius,
            legacyShape?.cornerRadius,
            rectangleDefaults.cornerRadius,
          ) ?? rectangleDefaults.cornerRadius,
      }
    }
    case 'ellipse': {
      const ellipseDefaults = defaults as EllipseMaskConfig
      return {
        ...base,
        type,
        ellipseWidth:
          pickNumericValue(
            patch.ellipseWidth,
            legacyShape?.ellipseWidth,
            ellipseDefaults.ellipseWidth,
          ) ?? ellipseDefaults.ellipseWidth,
        ellipseHeight:
          pickNumericValue(
            patch.ellipseHeight,
            legacyShape?.ellipseHeight,
            ellipseDefaults.ellipseHeight,
          ) ?? ellipseDefaults.ellipseHeight,
      }
    }
    case 'linear':
      return {
        ...base,
        type,
      }
    case 'mirror': {
      const mirrorDefaults = defaults as MirrorMaskConfig
      return {
        ...base,
        type,
        length:
          pickNumericValue(patch.length, legacyShape?.length, mirrorDefaults.length) ??
          mirrorDefaults.length,
      }
    }
  }
}

export function replaceMaskType(
  mask: MaskConfigPatch | Partial<MaskConfig> | null | undefined,
  type: MaskType,
  textureSize?: Partial<MaskTextureSize> | null,
): MaskConfig {
  const normalized = normalizeMaskConfig(mask, textureSize)
  const nextDefaults = createDefaultMaskConfig(type, textureSize)

  return {
    ...nextDefaults,
    enabled: normalized.enabled,
    inverted: normalized.inverted,
    centerX: normalized.centerX,
    centerY: normalized.centerY,
    rotation: normalized.rotation,
    falloff: {
      outerRange: normalized.falloff.outerRange,
      decayRate: normalized.falloff.decayRate,
    },
  }
}

export function getMaskAnimatableProps(
  mask?: MaskConfigPatch | Partial<MaskConfig> | null,
  textureSize?: Partial<MaskTextureSize> | null,
): MaskAnimatableProps {
  const normalized = normalizeMaskConfig(mask, textureSize)

  return {
    'mask.centerX': normalized.centerX,
    'mask.centerY': normalized.centerY,
    'mask.rotation': normalized.rotation,
    'mask.width': normalized.type === 'rectangle' ? normalized.width : 0,
    'mask.height': normalized.type === 'rectangle' ? normalized.height : 0,
    'mask.ellipseWidth': normalized.type === 'ellipse' ? normalized.ellipseWidth : 0,
    'mask.ellipseHeight': normalized.type === 'ellipse' ? normalized.ellipseHeight : 0,
    'mask.cornerRadius': normalized.type === 'rectangle' ? normalized.cornerRadius : 0,
    'mask.length': normalized.type === 'mirror' ? normalized.length : 0,
    'mask.outerRange': normalized.falloff.outerRange,
    'mask.decayRate': normalized.falloff.decayRate,
  }
}

export function setMaskPropertyValue(
  mask: MaskConfigPatch | Partial<MaskConfig> | null | undefined,
  path: MaskPropertyPath,
  value: number,
  textureSize?: Partial<MaskTextureSize> | null,
): MaskConfig {
  const normalized = normalizeMaskConfig(mask, textureSize)

  switch (path) {
    case 'mask.centerX':
      return { ...normalized, centerX: value }
    case 'mask.centerY':
      return { ...normalized, centerY: value }
    case 'mask.rotation':
      return { ...normalized, rotation: value }
    case 'mask.width':
      return normalized.type === 'rectangle' ? { ...normalized, width: value } : normalized
    case 'mask.height':
      return normalized.type === 'rectangle' ? { ...normalized, height: value } : normalized
    case 'mask.cornerRadius':
      return normalized.type === 'rectangle' ? { ...normalized, cornerRadius: value } : normalized
    case 'mask.ellipseWidth':
      return normalized.type === 'ellipse' ? { ...normalized, ellipseWidth: value } : normalized
    case 'mask.ellipseHeight':
      return normalized.type === 'ellipse' ? { ...normalized, ellipseHeight: value } : normalized
    case 'mask.length':
      return normalized.type === 'mirror' ? { ...normalized, length: value } : normalized
    case 'mask.outerRange':
      return {
        ...normalized,
        falloff: {
          ...normalized.falloff,
          outerRange: value,
        },
      }
    case 'mask.decayRate':
      return {
        ...normalized,
        falloff: {
          ...normalized.falloff,
          decayRate: value,
        },
      }
  }
}
