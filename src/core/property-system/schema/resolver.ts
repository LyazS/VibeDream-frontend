import type { MediaType } from '@/core/mediaitem'
import type { EffectPackageParameterDefinition } from '@/core/effect-package/types'
import type { UnifiedTimelineItemData } from '@/core/timelineitem'
import { supportsClipFilter } from '@/core/timelineitem/filter'
import {
  audioVolumeSchema,
  filterIntensitySchema,
  transformOpacitySchema,
  transformPositionSchema,
  transformRotationSchema,
  transformSizeSchema,
  type AnimatablePropertySchema,
} from './animatablePropertySchemas'

const FILTER_PARAM_PROPERTY_PREFIX = 'filter.param.'
const FILTER_PARAM_KEY_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/

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
    if (!propertyId.startsWith(FILTER_PARAM_PROPERTY_PREFIX)) {
      return null
    }

    const parameterKey = propertyId.slice(FILTER_PARAM_PROPERTY_PREFIX.length)
    const definition = this.getParameterDefinition(context, parameterKey)
    if (!definition || definition.type !== 'number') {
      return null
    }

    return this.createNumberParamSchema(parameterKey, definition)
  }

  listSchemas(context: PropertySchemaContext): AnimatablePropertySchema[] {
    if (!supportsClipFilter(context.item) || !context.item.filterEffect) {
      return []
    }

    return Object.entries(context.item.filterEffect.packagePayload.parameterSchema)
      .filter(([key, definition]) => this.isValidParameterKey(key) && definition.type === 'number')
      .map(([key, definition]) => this.createNumberParamSchema(key, definition))
  }

  private getParameterDefinition(
    context: PropertySchemaContext,
    parameterKey: string,
  ): EffectPackageParameterDefinition | null {
    if (!this.isValidParameterKey(parameterKey)) {
      return null
    }

    if (!supportsClipFilter(context.item) || !context.item.filterEffect) {
      return null
    }

    return context.item.filterEffect.packagePayload.parameterSchema[parameterKey] ?? null
  }

  private createNumberParamSchema(
    parameterKey: string,
    definition: EffectPackageParameterDefinition,
  ): AnimatablePropertySchema {
    return {
      propertyId: `${FILTER_PARAM_PROPERTY_PREFIX}${parameterKey}`,
      animationGroupId: `${FILTER_PARAM_PROPERTY_PREFIX}${parameterKey}`,
      target: 'filterEffect',
      valueFields: ['value'],
      valueKind: 'number',
      supportsDirectCommit: true,
      supportsKeyframeToggle: true,
      supportsTransientOverlay: true,
      label: parameterKey,
      min: definition.min,
      max: definition.max,
      step: definition.step,
    }
  }

  private isValidParameterKey(parameterKey: string): boolean {
    return FILTER_PARAM_KEY_PATTERN.test(parameterKey)
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
