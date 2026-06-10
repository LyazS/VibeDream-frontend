import { computed, type Ref } from 'vue'
import type { ClipFilterConfig } from '@/core/filter/types'
import {
  getFilterParamKey,
  isFilterParamPropertyId,
  propertySchemaResolver,
  type DynamicFilterParamPropertyId,
} from '@/core/property-system/schema'
import type { FilterChannelKey, FilterParamVec2Value, FilterTimelineItem } from './types'

export type DynamicFilterParamViewModel =
  | {
      kind: 'number'
      propertyId: DynamicFilterParamPropertyId
      parameterKey: string
      channelKey: FilterChannelKey
      label: string
      value: number
      min: number
      max: number
      step: number
    }
  | {
      kind: 'vec2'
      propertyId: DynamicFilterParamPropertyId
      parameterKey: string
      channelKey: FilterChannelKey
      label: string
      value: FilterParamVec2Value
      min: number
      max: number
      step: number
    }
  | {
      kind: 'boolean'
      propertyId: DynamicFilterParamPropertyId
      parameterKey: string
      label: string
      value: boolean
    }

interface UseDynamicFilterParamViewModelsOptions {
  selectedTimelineItem: Ref<FilterTimelineItem | null>
  currentFrame: Ref<number>
  filterConfig: Ref<ClipFilterConfig>
  hasFilterEffect: Ref<boolean>
}

export function useDynamicFilterParamViewModels(options: UseDynamicFilterParamViewModelsOptions) {
  const { selectedTimelineItem, currentFrame, filterConfig, hasFilterEffect } = options

  return computed<DynamicFilterParamViewModel[]>(() => {
    const item = selectedTimelineItem.value
    if (!item || !hasFilterEffect.value) {
      return []
    }

    return propertySchemaResolver
      .listSchemas({
        item,
        frame: currentFrame.value,
      })
      .filter((schema) => isFilterParamPropertyId(schema.propertyId))
      .map((schema) => {
        if (!isFilterParamPropertyId(schema.propertyId)) {
          throw new Error(`动态滤镜参数 propertyId 非法: ${schema.propertyId}`)
        }

        const parameterKey = getFilterParamKey(schema.propertyId)
        const label = schema.label ?? schema.propertyId

        if (schema.valueKind === 'number') {
          return {
            kind: 'number',
            propertyId: schema.propertyId,
            parameterKey,
            channelKey: schema.propertyId,
            label,
            value: getNumberValue(filterConfig.value.params[parameterKey], parameterKey),
            ...getNumberRange(schema.propertyId, schema),
          }
        }

        if (schema.valueKind === 'vec2') {
          return {
            kind: 'vec2',
            propertyId: schema.propertyId,
            parameterKey,
            channelKey: schema.propertyId,
            label,
            value: getVec2Value(filterConfig.value.params[parameterKey], parameterKey),
            ...getNumberRange(schema.propertyId, schema),
          }
        }

        if (schema.valueKind === 'boolean') {
          return {
            kind: 'boolean',
            propertyId: schema.propertyId,
            parameterKey,
            label,
            value: Boolean(filterConfig.value.params[parameterKey]),
          }
        }

        throw new Error(`动态滤镜参数类型不支持: ${schema.propertyId}`)
      })
  })
}

function getNumberValue(value: unknown, parameterKey: string): number {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value
  }
  throw new Error(`滤镜参数不是有效数字: ${parameterKey}`)
}

function getVec2Value(value: unknown, parameterKey: string): FilterParamVec2Value {
  if (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    typeof (value as Record<string, unknown>).x === 'number' &&
    Number.isFinite((value as Record<string, unknown>).x) &&
    typeof (value as Record<string, unknown>).y === 'number' &&
    Number.isFinite((value as Record<string, unknown>).y)
  ) {
    return {
      x: (value as FilterParamVec2Value).x,
      y: (value as FilterParamVec2Value).y,
    }
  }
  throw new Error(`滤镜参数不是有效二维向量: ${parameterKey}`)
}

function getNumberRange(
  propertyId: DynamicFilterParamPropertyId,
  schema: { min?: number; max?: number; step?: number },
): { min: number; max: number; step: number } {
  if (typeof schema.min !== 'number' || !Number.isFinite(schema.min)) {
    throw new Error(`滤镜参数 schema 缺少有效 min: ${propertyId}`)
  }
  if (typeof schema.max !== 'number' || !Number.isFinite(schema.max)) {
    throw new Error(`滤镜参数 schema 缺少有效 max: ${propertyId}`)
  }
  if (typeof schema.step !== 'number' || !Number.isFinite(schema.step)) {
    throw new Error(`滤镜参数 schema 缺少有效 step: ${propertyId}`)
  }
  return {
    min: schema.min,
    max: schema.max,
    step: schema.step,
  }
}
