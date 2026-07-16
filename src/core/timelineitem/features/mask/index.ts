import type { AnimationGroupId } from '../../model/render'

export type MaskType = 'rectangle' | 'ellipse' | 'linear' | 'mirror'

export interface MaskTextureSize {
  width: number
  height: number
}

/**
 * Pixel-space geometry derived from the persisted normalized mask config.
 * WebGL shaders and canvas overlays must consume this shape rather than
 * converting normalized values independently.
 */
export type MaskPixelGeometry = MaskConfig

export interface MaskFalloff {
  outerRange: number
  decayRate: number
}

interface BaseMaskConfig {
  enabled: boolean
  type: MaskType
  inverted: boolean
  /** Normalized center coordinates; (0.5, 0.5) is the item center. */
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
}

export interface MaskCenterValue {
  centerX: number
  centerY: number
}

export interface MaskRotationValue {
  rotation: number
}

export interface MaskFeatherValue {
  outerRange: number
}

export interface MaskIntensityValue {
  decayRate: number
}

export interface MaskRectangleSizeValue {
  width: number
  height: number
}

export interface MaskRectangleCornerRadiusValue {
  cornerRadius: number
}

export interface MaskEllipseSizeValue {
  ellipseWidth: number
  ellipseHeight: number
}

export interface MaskMirrorValue {
  length: number
}

export type MaskPropertyPath =
  | 'mask.centerX'
  | 'mask.centerY'
  | 'mask.rotation'
  | 'mask.width'
  | 'mask.height'
  | 'mask.ellipseWidth'
  | 'mask.ellipseHeight'
  | 'mask.cornerRadius'
  | 'mask.length'
  | 'mask.outerRange'
  | 'mask.decayRate'

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

function normalizeMaskType(type: unknown): MaskType {
  if (type === 'rectangle' || type === 'ellipse' || type === 'linear' || type === 'mirror') {
    return type
  }

  return 'rectangle'
}

function sanitizeMaskTextureSize(textureSize?: Partial<MaskTextureSize> | null): MaskTextureSize {
  const width = textureSize?.width
  const height = textureSize?.height

  return {
    width: typeof width === 'number' && Number.isFinite(width) && width > 0 ? width : 1,
    height: typeof height === 'number' && Number.isFinite(height) && height > 0 ? height : 1,
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

function clampUnitValue(value: number): number {
  return Math.min(Math.max(value, 0), 1)
}

function normalizeNonNegativeValue(value: number | undefined, fallback: number): number {
  if (value === undefined || !Number.isFinite(value)) {
    return fallback
  }

  return Math.max(0, value)
}

function normalizeRectangleCornerRadius(cornerRadius: number | undefined): number {
  if (cornerRadius === undefined || !Number.isFinite(cornerRadius)) {
    return 0
  }
  return clampUnitValue(cornerRadius)
}

function createBaseMaskDefaults(
  type: MaskType,
): BaseMaskConfig {
  return {
    enabled: false,
    type,
    inverted: false,
    centerX: 0.5,
    centerY: 0.5,
    rotation: 0,
    falloff: { outerRange: 0.1, decayRate: 1 },
  }
}

function createTypeDefaults(
  type: MaskType,
): RectangleMaskConfig | EllipseMaskConfig | LinearMaskConfig | MirrorMaskConfig {
  const base = createBaseMaskDefaults(type)

  switch (type) {
    case 'rectangle':
      return {
        ...base,
        type,
        width: 0.6,
        height: 0.6,
        cornerRadius: 0,
      }
    case 'ellipse':
      return {
        ...base,
        type,
        ellipseWidth: 0.6,
        ellipseHeight: 0.4,
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
        length: 0.6,
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
  _textureSize?: Partial<MaskTextureSize> | null,
): MaskConfig {
  return createTypeDefaults(type)
}

export function normalizeMaskConfig(
  mask?: MaskConfigPatch | Partial<MaskConfig> | null,
  _textureSize?: Partial<MaskTextureSize> | null,
): MaskConfig {
  const patch = (mask ?? {}) as MaskConfigPatch
  const type = normalizeMaskType(patch.type)
  const defaults = createTypeDefaults(type)

  const base = {
    enabled: patch.enabled ?? defaults.enabled,
    type,
    inverted: patch.inverted ?? defaults.inverted,
    centerX: pickNumericValue(patch.centerX, defaults.centerX) ?? defaults.centerX,
    centerY: pickNumericValue(patch.centerY, defaults.centerY) ?? defaults.centerY,
    rotation: pickNumericValue(patch.rotation, defaults.rotation) ?? defaults.rotation,
    falloff: {
      outerRange: normalizeNonNegativeValue(
        pickNumericValue(patch.falloff?.outerRange, defaults.falloff.outerRange),
        defaults.falloff.outerRange,
      ),
      decayRate: clampUnitValue(
        pickNumericValue(patch.falloff?.decayRate, defaults.falloff.decayRate) ??
          defaults.falloff.decayRate,
      ),
    },
  } as const

  switch (type) {
    case 'rectangle': {
      const rectangleDefaults = defaults as RectangleMaskConfig
      const width = normalizeNonNegativeValue(
        pickNumericValue(patch.width, rectangleDefaults.width),
        rectangleDefaults.width,
      )
      const height = normalizeNonNegativeValue(
        pickNumericValue(patch.height, rectangleDefaults.height),
        rectangleDefaults.height,
      )

      return {
        ...base,
        type,
        width,
        height,
        cornerRadius: normalizeRectangleCornerRadius(
          pickNumericValue(patch.cornerRadius, rectangleDefaults.cornerRadius) ??
            rectangleDefaults.cornerRadius,
        ),
      }
    }
    case 'ellipse': {
      const ellipseDefaults = defaults as EllipseMaskConfig
      return {
        ...base,
        type,
        ellipseWidth: normalizeNonNegativeValue(
          pickNumericValue(patch.ellipseWidth, ellipseDefaults.ellipseWidth),
          ellipseDefaults.ellipseWidth,
        ),
        ellipseHeight: normalizeNonNegativeValue(
          pickNumericValue(patch.ellipseHeight, ellipseDefaults.ellipseHeight),
          ellipseDefaults.ellipseHeight,
        ),
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
        length: normalizeNonNegativeValue(
          pickNumericValue(patch.length, mirrorDefaults.length),
          mirrorDefaults.length,
        ),
      }
    }
  }
}

/**
 * Converts the canonical item-normalized config to the pixel-space geometry
 * consumed by the render pass and preview overlay. The Y value remains in the
 * project's Y-up coordinate system.
 */
export function resolveMaskPixelGeometry(
  mask?: MaskConfigPatch | Partial<MaskConfig> | null,
  textureSize?: Partial<MaskTextureSize> | null,
): MaskPixelGeometry {
  const normalized = normalizeMaskConfig(mask)
  const size = sanitizeMaskTextureSize(textureSize)
  const shortSide = Math.min(size.width, size.height)
  const base = {
    ...normalized,
    centerX: (normalized.centerX - 0.5) * size.width,
    // Shader texture coordinates increase upward, while the persisted project
    // coordinate system defines normalized Y upward as well.
    centerY: (0.5 - normalized.centerY) * size.height,
    falloff: {
      outerRange: normalized.falloff.outerRange * shortSide,
      decayRate: normalized.falloff.decayRate,
    },
  }

  switch (normalized.type) {
    case 'rectangle':
      return {
        ...base,
        type: 'rectangle',
        width: normalized.width * size.width,
        height: normalized.height * size.height,
        cornerRadius: normalized.cornerRadius,
      }
    case 'ellipse':
      return {
        ...base,
        type: 'ellipse',
        ellipseWidth: normalized.ellipseWidth * size.width,
        ellipseHeight: normalized.ellipseHeight * size.height,
      }
    case 'linear':
      return { ...base, type: 'linear' }
    case 'mirror':
      return {
        ...base,
        type: 'mirror',
        length: normalized.length * size.width,
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
): Record<MaskPropertyPath, number> {
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

export function getMaskCenterValue(
  mask?: MaskConfigPatch | Partial<MaskConfig> | null,
  textureSize?: Partial<MaskTextureSize> | null,
): MaskCenterValue {
  const normalized = normalizeMaskConfig(mask, textureSize)
  return {
    centerX: normalized.centerX,
    centerY: normalized.centerY,
  }
}

export function getMaskRotationValue(
  mask?: MaskConfigPatch | Partial<MaskConfig> | null,
  textureSize?: Partial<MaskTextureSize> | null,
): MaskRotationValue {
  const normalized = normalizeMaskConfig(mask, textureSize)
  return {
    rotation: normalized.rotation,
  }
}

export function getMaskFeatherValue(
  mask?: MaskConfigPatch | Partial<MaskConfig> | null,
  textureSize?: Partial<MaskTextureSize> | null,
): MaskFeatherValue {
  const normalized = normalizeMaskConfig(mask, textureSize)
  return {
    outerRange: normalized.falloff.outerRange,
  }
}

export function getMaskIntensityValue(
  mask?: MaskConfigPatch | Partial<MaskConfig> | null,
  textureSize?: Partial<MaskTextureSize> | null,
): MaskIntensityValue {
  const normalized = normalizeMaskConfig(mask, textureSize)
  return {
    decayRate: normalized.falloff.decayRate,
  }
}

export function getMaskRectangleSizeValue(
  mask?: MaskConfigPatch | Partial<MaskConfig> | null,
  textureSize?: Partial<MaskTextureSize> | null,
): MaskRectangleSizeValue {
  const normalized = normalizeMaskConfig(mask, textureSize)
  if (normalized.type === 'rectangle') {
    return {
      width: normalized.width,
      height: normalized.height,
    }
  }

  const defaults = createDefaultMaskConfig('rectangle', textureSize) as RectangleMaskConfig
  return {
    width: defaults.width,
    height: defaults.height,
  }
}

export function getMaskRectangleCornerRadiusValue(
  mask?: MaskConfigPatch | Partial<MaskConfig> | null,
  textureSize?: Partial<MaskTextureSize> | null,
): MaskRectangleCornerRadiusValue {
  const normalized = normalizeMaskConfig(mask, textureSize)
  if (normalized.type === 'rectangle') {
    return {
      cornerRadius: normalized.cornerRadius,
    }
  }

  const defaults = createDefaultMaskConfig('rectangle', textureSize) as RectangleMaskConfig
  return {
    cornerRadius: defaults.cornerRadius,
  }
}

export function getMaskEllipseSizeValue(
  mask?: MaskConfigPatch | Partial<MaskConfig> | null,
  textureSize?: Partial<MaskTextureSize> | null,
): MaskEllipseSizeValue {
  const normalized = normalizeMaskConfig(mask, textureSize)
  if (normalized.type === 'ellipse') {
    return {
      ellipseWidth: normalized.ellipseWidth,
      ellipseHeight: normalized.ellipseHeight,
    }
  }

  const defaults = createDefaultMaskConfig('ellipse', textureSize) as EllipseMaskConfig
  return {
    ellipseWidth: defaults.ellipseWidth,
    ellipseHeight: defaults.ellipseHeight,
  }
}

export function getMaskMirrorValue(
  mask?: MaskConfigPatch | Partial<MaskConfig> | null,
  textureSize?: Partial<MaskTextureSize> | null,
): MaskMirrorValue {
  const normalized = normalizeMaskConfig(mask, textureSize)
  if (normalized.type === 'mirror') {
    return { length: normalized.length }
  }

  const defaults = createDefaultMaskConfig('mirror', textureSize) as MirrorMaskConfig
  return { length: defaults.length }
}

export function applyMaskCenterValue(
  mask: MaskConfigPatch | Partial<MaskConfig> | null | undefined,
  patch: Partial<MaskCenterValue>,
  textureSize?: Partial<MaskTextureSize> | null,
): MaskConfig {
  const normalized = normalizeMaskConfig(mask, textureSize)
  return {
    ...normalized,
    centerX: patch.centerX ?? normalized.centerX,
    centerY: patch.centerY ?? normalized.centerY,
  }
}

export function applyMaskRotationValue(
  mask: MaskConfigPatch | Partial<MaskConfig> | null | undefined,
  patch: Partial<MaskRotationValue>,
  textureSize?: Partial<MaskTextureSize> | null,
): MaskConfig {
  const normalized = normalizeMaskConfig(mask, textureSize)
  return {
    ...normalized,
    rotation: patch.rotation ?? normalized.rotation,
  }
}

export function applyMaskFeatherValue(
  mask: MaskConfigPatch | Partial<MaskConfig> | null | undefined,
  patch: Partial<MaskFeatherValue>,
  textureSize?: Partial<MaskTextureSize> | null,
): MaskConfig {
  const normalized = normalizeMaskConfig(mask, textureSize)
  return {
    ...normalized,
    falloff: {
      outerRange: normalizeNonNegativeValue(patch.outerRange, normalized.falloff.outerRange),
      decayRate: normalized.falloff.decayRate,
    },
  }
}

export function applyMaskIntensityValue(
  mask: MaskConfigPatch | Partial<MaskConfig> | null | undefined,
  patch: Partial<MaskIntensityValue>,
  textureSize?: Partial<MaskTextureSize> | null,
): MaskConfig {
  const normalized = normalizeMaskConfig(mask, textureSize)
  return {
    ...normalized,
    falloff: {
      outerRange: normalized.falloff.outerRange,
      decayRate: clampUnitValue(patch.decayRate ?? normalized.falloff.decayRate),
    },
  }
}

export function applyMaskRectangleSizeValue(
  mask: MaskConfigPatch | Partial<MaskConfig> | null | undefined,
  patch: Partial<MaskRectangleSizeValue>,
  textureSize?: Partial<MaskTextureSize> | null,
): MaskConfig {
  const normalized = normalizeMaskConfig(mask, textureSize)
  if (normalized.type !== 'rectangle') {
    return normalized
  }

  return {
    ...normalized,
    width: normalizeNonNegativeValue(patch.width, normalized.width),
    height: normalizeNonNegativeValue(patch.height, normalized.height),
  }
}

export function applyMaskRectangleCornerRadiusValue(
  mask: MaskConfigPatch | Partial<MaskConfig> | null | undefined,
  patch: Partial<MaskRectangleCornerRadiusValue>,
  textureSize?: Partial<MaskTextureSize> | null,
): MaskConfig {
  const normalized = normalizeMaskConfig(mask, textureSize)
  if (normalized.type !== 'rectangle') {
    return normalized
  }

  return {
    ...normalized,
    cornerRadius: normalizeRectangleCornerRadius(patch.cornerRadius ?? normalized.cornerRadius),
  }
}

export function applyMaskEllipseSizeValue(
  mask: MaskConfigPatch | Partial<MaskConfig> | null | undefined,
  patch: Partial<MaskEllipseSizeValue>,
  textureSize?: Partial<MaskTextureSize> | null,
): MaskConfig {
  const normalized = normalizeMaskConfig(mask, textureSize)
  if (normalized.type !== 'ellipse') {
    return normalized
  }

  return {
    ...normalized,
    ellipseWidth: normalizeNonNegativeValue(patch.ellipseWidth, normalized.ellipseWidth),
    ellipseHeight: normalizeNonNegativeValue(patch.ellipseHeight, normalized.ellipseHeight),
  }
}

export function applyMaskMirrorValue(
  mask: MaskConfigPatch | Partial<MaskConfig> | null | undefined,
  patch: Partial<MaskMirrorValue>,
  textureSize?: Partial<MaskTextureSize> | null,
): MaskConfig {
  const normalized = normalizeMaskConfig(mask, textureSize)
  if (normalized.type !== 'mirror') {
    return normalized
  }

  return {
    ...normalized,
    length: normalizeNonNegativeValue(patch.length, normalized.length),
  }
}

export function applyMaskGroupValue(
  mask: MaskConfigPatch | Partial<MaskConfig> | null | undefined,
  groupId: AnimationGroupId,
  patch: unknown,
  textureSize?: Partial<MaskTextureSize> | null,
): MaskConfig {
  switch (groupId) {
    case 'mask.center':
      return applyMaskCenterValue(mask, patch as Partial<MaskCenterValue>, textureSize)
    case 'mask.rotation':
      return applyMaskRotationValue(mask, patch as Partial<MaskRotationValue>, textureSize)
    case 'mask.feather':
      return applyMaskFeatherValue(mask, patch as Partial<MaskFeatherValue>, textureSize)
    case 'mask.intensity':
      return applyMaskIntensityValue(mask, patch as Partial<MaskIntensityValue>, textureSize)
    case 'mask.rectangle.size':
      return applyMaskRectangleSizeValue(mask, patch as Partial<MaskRectangleSizeValue>, textureSize)
    case 'mask.rectangle.cornerRadius':
      return applyMaskRectangleCornerRadiusValue(
        mask,
        patch as Partial<MaskRectangleCornerRadiusValue>,
        textureSize,
      )
    case 'mask.ellipse.size':
      return applyMaskEllipseSizeValue(mask, patch as Partial<MaskEllipseSizeValue>, textureSize)
    case 'mask.mirror.length':
      return applyMaskMirrorValue(mask, patch as Partial<MaskMirrorValue>, textureSize)
    default:
      throw new Error(`不支持的蒙版动画组静态写入: ${groupId}`)
  }
}

export function setMaskPropertyValue(
  mask: MaskConfigPatch | Partial<MaskConfig> | null | undefined,
  path: MaskPropertyPath,
  value: number,
  textureSize?: Partial<MaskTextureSize> | null,
): MaskConfig {
  switch (path) {
    case 'mask.centerX':
      return applyMaskCenterValue(mask, { centerX: value }, textureSize)
    case 'mask.centerY':
      return applyMaskCenterValue(mask, { centerY: value }, textureSize)
    case 'mask.rotation':
      return applyMaskRotationValue(mask, { rotation: value }, textureSize)
    case 'mask.width':
      return applyMaskRectangleSizeValue(mask, { width: value }, textureSize)
    case 'mask.height':
      return applyMaskRectangleSizeValue(mask, { height: value }, textureSize)
    case 'mask.cornerRadius':
      return applyMaskRectangleCornerRadiusValue(mask, { cornerRadius: value }, textureSize)
    case 'mask.ellipseWidth':
      return applyMaskEllipseSizeValue(mask, { ellipseWidth: value }, textureSize)
    case 'mask.ellipseHeight':
      return applyMaskEllipseSizeValue(mask, { ellipseHeight: value }, textureSize)
    case 'mask.length':
      return applyMaskMirrorValue(mask, { length: value }, textureSize)
    case 'mask.outerRange':
      return applyMaskFeatherValue(mask, { outerRange: value }, textureSize)
    case 'mask.decayRate':
      return applyMaskIntensityValue(mask, { decayRate: value }, textureSize)
  }
}

// Deprecated compatibility aliases.
export type MaskCommonValue = MaskCenterValue & MaskRotationValue & MaskFeatherValue & MaskIntensityValue
export type MaskRectangleValue = MaskRectangleSizeValue & MaskRectangleCornerRadiusValue
export type MaskEllipseValue = MaskEllipseSizeValue

export function getMaskCommonValue(
  mask?: MaskConfigPatch | Partial<MaskConfig> | null,
  textureSize?: Partial<MaskTextureSize> | null,
): MaskCommonValue {
  return {
    ...getMaskCenterValue(mask, textureSize),
    ...getMaskRotationValue(mask, textureSize),
    ...getMaskFeatherValue(mask, textureSize),
    ...getMaskIntensityValue(mask, textureSize),
  }
}

export function getMaskRectangleValue(
  mask?: MaskConfigPatch | Partial<MaskConfig> | null,
  textureSize?: Partial<MaskTextureSize> | null,
): MaskRectangleValue {
  return {
    ...getMaskRectangleSizeValue(mask, textureSize),
    ...getMaskRectangleCornerRadiusValue(mask, textureSize),
  }
}

export function getMaskEllipseValue(
  mask?: MaskConfigPatch | Partial<MaskConfig> | null,
  textureSize?: Partial<MaskTextureSize> | null,
): MaskEllipseValue {
  return getMaskEllipseSizeValue(mask, textureSize)
}

export function applyMaskCommonValue(
  mask: MaskConfigPatch | Partial<MaskConfig> | null | undefined,
  patch: Partial<MaskCommonValue>,
  textureSize?: Partial<MaskTextureSize> | null,
): MaskConfig {
  return applyMaskIntensityValue(
    applyMaskFeatherValue(
      applyMaskRotationValue(
        applyMaskCenterValue(mask, patch, textureSize),
        patch,
        textureSize,
      ),
      patch,
      textureSize,
    ),
    patch,
    textureSize,
  )
}

export function applyMaskRectangleValue(
  mask: MaskConfigPatch | Partial<MaskConfig> | null | undefined,
  patch: Partial<MaskRectangleValue>,
  textureSize?: Partial<MaskTextureSize> | null,
): MaskConfig {
  return applyMaskRectangleCornerRadiusValue(
    applyMaskRectangleSizeValue(mask, patch, textureSize),
    patch,
    textureSize,
  )
}

export function applyMaskEllipseValue(
  mask: MaskConfigPatch | Partial<MaskConfig> | null | undefined,
  patch: Partial<MaskEllipseValue>,
  textureSize?: Partial<MaskTextureSize> | null,
): MaskConfig {
  return applyMaskEllipseSizeValue(mask, patch, textureSize)
}
