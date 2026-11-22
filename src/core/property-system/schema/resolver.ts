import type { MediaType } from '@/core/mediaitem'
import type { UnifiedTimelineItemData } from '@/core/timelineitem/model/timelineItem'
import {
  audioVolumeSchema,
  visualBlendIntensitySchema,
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
    visualBlendIntensitySchema,
    audioVolumeSchema,
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
])
