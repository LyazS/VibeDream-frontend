import { computed, type Ref } from 'vue'
import {
  normalizeFilterParamColor,
  type FilterParamColorValue,
} from '@/core/filter/color'
import type {
  DynamicEffectParamViewModel,
  EffectParamVec2Value,
  EffectParamVec3Value,
  EffectParamVec4Value,
  EffectParameterSchema,
} from './types'

interface UseDynamicEffectParamViewModelsOptions {
  params: Ref<Record<string, unknown>>
  parameterSchema: Ref<EffectParameterSchema>
}

export function useDynamicEffectParamViewModels(options: UseDynamicEffectParamViewModelsOptions) {
  const { params, parameterSchema } = options

  return computed<DynamicEffectParamViewModel[]>(() =>
    Object.entries(parameterSchema.value).map(([parameterKey, definition]) => {
      const label = parameterKey
      const value = params.value[parameterKey]

      if (definition.type === 'float' || definition.type === 'int') {
        const integerLike = definition.type === 'int'
        return {
          kind: definition.type,
          parameterKey,
          label,
          value: integerLike
            ? Math.round(getNumberValue(value, parameterKey))
            : getNumberValue(value, parameterKey),
          min: typeof definition.min === 'number' ? definition.min : 0,
          max: typeof definition.max === 'number' ? definition.max : 1,
          step: typeof definition.step === 'number' ? definition.step : integerLike ? 1 : 0.01,
          precision: integerLike ? 0 : 2,
        }
      }

      if (definition.type === 'vec2' || definition.type === 'ivec2') {
        const integerLike = definition.type === 'ivec2'
        return {
          kind: definition.type,
          parameterKey,
          label,
          value: getVec2Value(value, parameterKey, integerLike),
          min: typeof definition.min === 'number' ? definition.min : 0,
          max: typeof definition.max === 'number' ? definition.max : 1,
          step: typeof definition.step === 'number' ? definition.step : integerLike ? 1 : 0.01,
          precision: integerLike ? 0 : 2,
        }
      }

      if (definition.type === 'vec3') {
        return {
          kind: 'vec3',
          parameterKey,
          label,
          value: getVec3Value(value, parameterKey),
          min: typeof definition.min === 'number' ? definition.min : 0,
          max: typeof definition.max === 'number' ? definition.max : 1,
          step: typeof definition.step === 'number' ? definition.step : 0.01,
          precision: 2,
        }
      }

      if (definition.type === 'vec4') {
        return {
          kind: 'vec4',
          parameterKey,
          label,
          value: getVec4Value(value, parameterKey),
          min: typeof definition.min === 'number' ? definition.min : 0,
          max: typeof definition.max === 'number' ? definition.max : 1,
          step: typeof definition.step === 'number' ? definition.step : 0.01,
          precision: 2,
        }
      }

      if (definition.type === 'boolean') {
        return {
          kind: 'boolean',
          parameterKey,
          label,
          value: Boolean(value),
        }
      }

      if (definition.type === 'color') {
        return {
          kind: 'color',
          parameterKey,
          label,
          value: getColorValue(value, parameterKey),
        }
      }

      throw new Error(`动态效果参数类型不支持: ${parameterKey}`)
    }),
  )
}

function getNumberValue(value: unknown, parameterKey: string): number {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value
  }
  throw new Error(`效果参数不是有效数字: ${parameterKey}`)
}

function getVec2Value(
  value: unknown,
  parameterKey: string,
  integerLike = false,
): EffectParamVec2Value {
  const record = getVectorRecord(value, parameterKey, ['x', 'y'])
  return {
    x: integerLike ? Math.round(record.x) : record.x,
    y: integerLike ? Math.round(record.y) : record.y,
  }
}

function getVec3Value(value: unknown, parameterKey: string): EffectParamVec3Value {
  return getVectorRecord(value, parameterKey, ['x', 'y', 'z'])
}

function getVec4Value(value: unknown, parameterKey: string): EffectParamVec4Value {
  return getVectorRecord(value, parameterKey, ['x', 'y', 'z', 'w'])
}

type VectorField = 'x' | 'y' | 'z' | 'w'

function getVectorRecord<const TFields extends readonly VectorField[]>(
  value: unknown,
  parameterKey: string,
  fields: TFields,
): Record<TFields[number], number> {
  if (
    typeof value !== 'object' ||
    value === null ||
    Array.isArray(value)
  ) {
    throw new Error(`效果参数不是有效向量: ${parameterKey}`)
  }

  const valueRecord = value as Record<string, unknown>
  const normalized: Partial<Record<VectorField, number>> = {}
  for (const field of fields) {
    const fieldValue = valueRecord[field]
    if (typeof fieldValue !== 'number' || !Number.isFinite(fieldValue)) {
      throw new Error(`效果参数不是有效向量: ${parameterKey}`)
    }
    normalized[field] = fieldValue
  }
  return normalized as Record<TFields[number], number>
}

function getColorValue(value: unknown, parameterKey: string): FilterParamColorValue {
  try {
    return normalizeFilterParamColor(value)
  } catch {
    throw new Error(`效果参数不是有效颜色: ${parameterKey}`)
  }
}
