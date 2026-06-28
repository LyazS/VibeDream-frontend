import type { MediaType } from '@/core/mediaitem'
import type { EffectPackageParameterDefinition } from '@/core/effect-package/types'
import { normalizeFilterParamColor } from '@/core/filter/color'
import type { UnifiedTimelineItemData } from '@/core/timelineitem/model/timelineItem'
import { supportsClipFilter } from '@/core/timelineitem/features/filter'
import { TimelineItemQueries } from '@/core/timelineitem/queries'
import {
  createFilterParamPropertyId,
  getFilterParamKey,
  isFilterParamPropertyId,
  isValidFilterParamKey,
} from './propertyIds'
import {
  audioVolumeSchema,
  filterIntensitySchema,
  maskCenterSchema,
  maskFeatherSchema,
  maskIntensitySchema,
  maskEllipseSizeSchema,
  maskRectangleCornerRadiusSchema,
  maskRectangleSizeSchema,
  maskMirrorLengthSchema,
  maskRotationSchema,
  textContentSchema,
  textStyleBackgroundColorSchema,
  textStyleColorSchema,
  textStyleFontFamilySchema,
  textStyleFontSizeSchema,
  textStyleFontStyleSchema,
  textStyleFontWeightSchema,
  textStyleTextGlowSchema,
  textStyleTextAlignSchema,
  textStyleTextStrokeSchema,
  textStyleTextShadowSchema,
  visualOpacitySchema,
  visualPositionSchema,
  visualRotationSchema,
  visualSizeSchema,
  type AnimatablePropertySchema,
} from './animatablePropertySchemas'

export interface PropertySchemaContext {
  item: UnifiedTimelineItemData<MediaType>
  frame?: number
  locale?: string
}

export interface PropertySchemaProvider {
  getSchema(context: PropertySchemaContext, propertyId: string): AnimatablePropertySchema | null
  listSchemas(context: PropertySchemaContext): AnimatablePropertySchema[]
}

export class StaticPropertySchemaProvider implements PropertySchemaProvider {
  private readonly schemas = [
    visualRotationSchema,
    visualPositionSchema,
    visualSizeSchema,
    visualOpacitySchema,
    filterIntensitySchema,
    audioVolumeSchema,
    maskCenterSchema,
    maskRectangleSizeSchema,
    maskRectangleCornerRadiusSchema,
    maskEllipseSizeSchema,
    maskFeatherSchema,
    maskIntensitySchema,
    maskRotationSchema,
    maskMirrorLengthSchema,
    textContentSchema,
    textStyleBackgroundColorSchema,
    textStyleColorSchema,
    textStyleFontFamilySchema,
    textStyleFontSizeSchema,
    textStyleFontStyleSchema,
    textStyleFontWeightSchema,
    textStyleTextGlowSchema,
    textStyleTextAlignSchema,
    textStyleTextStrokeSchema,
    textStyleTextShadowSchema,
  ]

  getSchema(context: PropertySchemaContext, propertyId: string): AnimatablePropertySchema | null {
    void context
    return this.schemas.find((schema) => schema.propertyId === propertyId) ?? null
  }

  listSchemas(context: PropertySchemaContext): AnimatablePropertySchema[] {
    void context
    return [...this.schemas]
  }
}

export class DynamicFilterParameterSchemaProvider implements PropertySchemaProvider {
  getSchema(context: PropertySchemaContext, propertyId: string): AnimatablePropertySchema | null {
    if (!isFilterParamPropertyId(propertyId)) {
      return null
    }

    const parameterKey = getFilterParamKey(propertyId)
    const definition = this.getParameterDefinition(context, parameterKey)
    if (
      !definition ||
      (
        definition.type !== 'float' &&
        definition.type !== 'int' &&
        definition.type !== 'vec2' &&
        definition.type !== 'ivec2' &&
        definition.type !== 'boolean' &&
        definition.type !== 'color'
      )
    ) {
      return null
    }

    return this.createParamSchema(parameterKey, definition)
  }

  listSchemas(context: PropertySchemaContext): AnimatablePropertySchema[] {
    const filterConfig = TimelineItemQueries.getBaseExtraRenderConfig(context.item)?.filter
    if (!supportsClipFilter(context.item) || !filterConfig) {
      return []
    }

    return Object.entries(filterConfig.packagePayload.parameterSchema)
      .filter(([key, definition]) =>
        isValidFilterParamKey(key) &&
        (
          definition.type === 'float' ||
          definition.type === 'int' ||
          definition.type === 'vec2' ||
          definition.type === 'ivec2' ||
          definition.type === 'boolean' ||
          definition.type === 'color'
        ),
      )
      .map(([key, definition]) => this.createParamSchema(key, definition))
  }

  private getParameterDefinition(
    context: PropertySchemaContext,
    parameterKey: string,
  ): EffectPackageParameterDefinition | null {
    if (!isValidFilterParamKey(parameterKey)) {
      return null
    }

    const filterConfig = TimelineItemQueries.getBaseExtraRenderConfig(context.item)?.filter
    if (!supportsClipFilter(context.item) || !filterConfig) {
      return null
    }

    return filterConfig.packagePayload.parameterSchema[parameterKey] ?? null
  }

  private createParamSchema(
    parameterKey: string,
    definition: EffectPackageParameterDefinition,
  ): AnimatablePropertySchema {
    if (this.isScalarParamDefinition(definition)) {
      return this.createNumberParamSchema(parameterKey, definition)
    }
    if (definition.type === 'boolean') {
      return this.createBooleanParamSchema(parameterKey)
    }
    if (definition.type === 'color') {
      return this.createColorParamSchema(parameterKey, definition)
    }

    if (this.isVec2ParamDefinition(definition)) {
      return this.createVec2ParamSchema(parameterKey, definition)
    }

    throw new Error(`filter parameter type 不支持属性系统: ${parameterKey}`)
  }

  private isScalarParamDefinition(
    definition: EffectPackageParameterDefinition,
  ): definition is EffectPackageParameterDefinition & { type: 'float' | 'int' } {
    return definition.type === 'float' || definition.type === 'int'
  }

  private isVec2ParamDefinition(
    definition: EffectPackageParameterDefinition,
  ): definition is EffectPackageParameterDefinition & { type: 'vec2' | 'ivec2' } {
    return definition.type === 'vec2' || definition.type === 'ivec2'
  }

  private createBooleanParamSchema(parameterKey: string): AnimatablePropertySchema {
    const propertyId = createFilterParamPropertyId(parameterKey)

    return {
      propertyId,
      target: 'filter',
      valueFields: ['value'],
      valueKind: 'boolean',
      supportsDirectCommit: true,
      supportsKeyframeToggle: false,
      supportsTransientOverlay: false,
      label: parameterKey,
      normalizeDirectValue: (value) => ({
        params: {
          [parameterKey]: Boolean(value),
        },
      }),
    }
  }

  private createNumberParamSchema(
    parameterKey: string,
    definition: EffectPackageParameterDefinition & { type: 'float' | 'int' },
  ): AnimatablePropertySchema {
    this.assertFiniteNumberRange(parameterKey, definition, definition.type)
    if (typeof definition.default !== 'number' || !Number.isFinite(definition.default)) {
      throw new Error(`filter ${definition.type} parameter 缺少有效默认值: ${parameterKey}`)
    }

    const propertyId = createFilterParamPropertyId(parameterKey)
    const min = definition.min
    const max = definition.max
    const normalizeNumber = (value: unknown): number => {
      if (typeof value !== 'number' || !Number.isFinite(value)) {
        throw new Error(`${propertyId} requires a finite numeric value`)
      }

      const clamped = Math.min(max, Math.max(min, value))
      return definition.type === 'int' ? Math.round(clamped) : clamped
    }

    return {
      propertyId,
      animationGroupId: propertyId,
      target: 'filter',
      valueFields: ['value'],
      valueKind: 'number',
      supportsDirectCommit: true,
      supportsKeyframeToggle: true,
      supportsTransientOverlay: true,
      label: parameterKey,
      min: definition.min,
      max: definition.max,
      step: definition.step,
      normalizeDirectValue: (value) => ({
        params: {
          [parameterKey]: normalizeNumber(value),
        },
      }),
      normalizeKeyframeValue: (value) => ({
        value: normalizeNumber(value),
      }),
    }
  }

  private createColorParamSchema(
    parameterKey: string,
    definition: EffectPackageParameterDefinition,
  ): AnimatablePropertySchema {
    normalizeFilterParamColor(definition.default)

    const propertyId = createFilterParamPropertyId(parameterKey)
    return {
      propertyId,
      animationGroupId: propertyId,
      target: 'filter',
      valueFields: ['r', 'g', 'b', 'a'],
      valueKind: 'color',
      supportsDirectCommit: true,
      supportsKeyframeToggle: true,
      supportsTransientOverlay: true,
      label: parameterKey,
      normalizeDirectValue: (value) => ({
        params: {
          [parameterKey]: normalizeFilterParamColor(value),
        },
      }),
      normalizeKeyframeValue: (value) => {
        const color = normalizeFilterParamColor(value)
        return {
          r: color.r,
          g: color.g,
          b: color.b,
          a: color.a,
        }
      },
    }
  }

  private createVec2ParamSchema(
    parameterKey: string,
    definition: EffectPackageParameterDefinition & { type: 'vec2' | 'ivec2' },
  ): AnimatablePropertySchema {
    this.assertFiniteNumberRange(parameterKey, definition, definition.type)
    this.normalizeVec2(definition.default, `filter ${definition.type} parameter 缺少有效默认值: ${parameterKey}`)

    const propertyId = createFilterParamPropertyId(parameterKey)
    const min = definition.min
    const max = definition.max
    const normalizeVec2 = (value: unknown) => {
      const nextValue = this.normalizeVec2(value, `${propertyId} requires finite numeric x/y values`)
      return {
        x: this.normalizeVectorComponent(nextValue.x, min, max, definition.type),
        y: this.normalizeVectorComponent(nextValue.y, min, max, definition.type),
      }
    }

    return {
      propertyId,
      animationGroupId: propertyId,
      target: 'filter',
      valueFields: ['x', 'y'],
      valueKind: 'vec2',
      supportsDirectCommit: true,
      supportsKeyframeToggle: true,
      supportsTransientOverlay: true,
      label: parameterKey,
      min: definition.min,
      max: definition.max,
      step: definition.step,
      normalizeDirectValue: (value) => ({
        params: {
          [parameterKey]: normalizeVec2(value),
        },
      }),
      normalizeKeyframeValue: (value) => normalizeVec2(value),
    }
  }

  private assertFiniteNumberRange(
    parameterKey: string,
    definition: EffectPackageParameterDefinition,
    type: 'float' | 'int' | 'vec2' | 'ivec2',
  ): asserts definition is EffectPackageParameterDefinition & { min: number; max: number; step: number } {
    if (typeof definition.min !== 'number' || !Number.isFinite(definition.min)) {
      throw new Error(`filter ${type} parameter 缺少有效 min: ${parameterKey}`)
    }
    if (typeof definition.max !== 'number' || !Number.isFinite(definition.max)) {
      throw new Error(`filter ${type} parameter 缺少有效 max: ${parameterKey}`)
    }
    if (typeof definition.step !== 'number' || !Number.isFinite(definition.step)) {
      throw new Error(`filter ${type} parameter 缺少有效 step: ${parameterKey}`)
    }
  }

  private normalizeVec2(value: unknown, errorMessage: string): { x: number; y: number } {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
      throw new Error(errorMessage)
    }

    const record = value as Record<string, unknown>
    if (typeof record.x !== 'number' || !Number.isFinite(record.x)) {
      throw new Error(errorMessage)
    }
    if (typeof record.y !== 'number' || !Number.isFinite(record.y)) {
      throw new Error(errorMessage)
    }

    return {
      x: record.x,
      y: record.y,
    }
  }

  private normalizeVectorComponent(
    value: number,
    min: number,
    max: number,
    type: 'vec2' | 'ivec2',
  ): number {
    const clamped = Math.min(max, Math.max(min, value))
    return type === 'ivec2' ? Math.round(clamped) : clamped
  }
}

export class PropertySchemaResolver {
  constructor(private readonly providers: readonly PropertySchemaProvider[]) {}

  getSchema(context: PropertySchemaContext, propertyId: string): AnimatablePropertySchema | null {
    for (const provider of this.providers) {
      const schema = provider.getSchema(context, propertyId)
      if (schema) return schema
    }
    return null
  }

  listSchemas(context: PropertySchemaContext): AnimatablePropertySchema[] {
    return this.providers.flatMap((provider) => provider.listSchemas(context))
  }
}

export const propertySchemaResolver = new PropertySchemaResolver([
  new StaticPropertySchemaProvider(),
  new DynamicFilterParameterSchemaProvider(),
])
