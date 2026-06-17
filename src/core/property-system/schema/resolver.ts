import type { MediaType } from '@/core/mediaitem'
import type { EffectPackageParameterDefinition } from '@/core/effect-package/types'
import type { UnifiedTimelineItemData } from '@/core/timelineitem'
import { supportsClipFilter } from '@/core/timelineitem/filter'
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
  transformOpacitySchema,
  transformPositionSchema,
  transformRotationSchema,
  transformSizeSchema,
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
    transformRotationSchema,
    transformPositionSchema,
    transformSizeSchema,
    transformOpacitySchema,
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

  getSchema(_context: PropertySchemaContext, propertyId: string): AnimatablePropertySchema | null {
    return this.schemas.find((schema) => schema.propertyId === propertyId) ?? null
  }

  listSchemas(_context: PropertySchemaContext): AnimatablePropertySchema[] {
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
    if (!definition || (definition.type !== 'number' && definition.type !== 'vec2' && definition.type !== 'boolean')) {
      return null
    }

    return this.createParamSchema(parameterKey, definition)
  }

  listSchemas(context: PropertySchemaContext): AnimatablePropertySchema[] {
    const filterConfig = TimelineItemQueries.getExtraRenderConfig(context.item)?.filter
    if (!supportsClipFilter(context.item) || !filterConfig) {
      return []
    }

    return Object.entries(filterConfig.packagePayload.parameterSchema)
      .filter(([key, definition]) =>
        isValidFilterParamKey(key) &&
        (definition.type === 'number' || definition.type === 'vec2' || definition.type === 'boolean'),
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

    const filterConfig = TimelineItemQueries.getExtraRenderConfig(context.item)?.filter
    if (!supportsClipFilter(context.item) || !filterConfig) {
      return null
    }

    return filterConfig.packagePayload.parameterSchema[parameterKey] ?? null
  }

  private createParamSchema(
    parameterKey: string,
    definition: EffectPackageParameterDefinition,
  ): AnimatablePropertySchema {
    if (definition.type === 'number') {
      return this.createNumberParamSchema(parameterKey, definition)
    }
    if (definition.type === 'boolean') {
      return this.createBooleanParamSchema(parameterKey)
    }

    return this.createVec2ParamSchema(parameterKey, definition)
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
    definition: EffectPackageParameterDefinition,
  ): AnimatablePropertySchema {
    this.assertFiniteNumberRange(parameterKey, definition, 'number')
    if (typeof definition.default !== 'number' || !Number.isFinite(definition.default)) {
      throw new Error(`filter number parameter 缺少有效默认值: ${parameterKey}`)
    }

    const propertyId = createFilterParamPropertyId(parameterKey)
    const min = definition.min
    const max = definition.max
    const normalizeNumber = (value: unknown): number => {
      if (typeof value !== 'number' || !Number.isFinite(value)) {
        throw new Error(`${propertyId} requires a finite numeric value`)
      }

      return Math.min(max, Math.max(min, value))
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

  private createVec2ParamSchema(
    parameterKey: string,
    definition: EffectPackageParameterDefinition,
  ): AnimatablePropertySchema {
    this.assertFiniteNumberRange(parameterKey, definition, 'vec2')
    this.normalizeVec2(definition.default, `filter vec2 parameter 缺少有效默认值: ${parameterKey}`)

    const propertyId = createFilterParamPropertyId(parameterKey)
    const min = definition.min
    const max = definition.max
    const normalizeVec2 = (value: unknown) => {
      const nextValue = this.normalizeVec2(value, `${propertyId} requires finite numeric x/y values`)
      return {
        x: Math.min(max, Math.max(min, nextValue.x)),
        y: Math.min(max, Math.max(min, nextValue.y)),
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
    type: 'number' | 'vec2',
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
