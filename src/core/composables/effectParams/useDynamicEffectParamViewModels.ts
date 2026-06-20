import { computed, type Ref } from 'vue'
import {
  normalizeFilterParamColor,
  type FilterParamColorValue,
} from '@/core/filter/color'
import type { DynamicEffectParamViewModel, EffectParamVec2Value, EffectParameterSchema } from './types'

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

      if (definition.type === 'number') {
        return {
          kind: 'number',
          parameterKey,
          label,
          value: getNumberValue(value, parameterKey),
          min: typeof definition.min === 'number' ? definition.min : 0,
          max: typeof definition.max === 'number' ? definition.max : 1,
          step: typeof definition.step === 'number' ? definition.step : 0.01,
        }
      }

      if (definition.type === 'vec2') {
        return {
          kind: 'vec2',
          parameterKey,
          label,
          value: getVec2Value(value, parameterKey),
          min: typeof definition.min === 'number' ? definition.min : 0,
          max: typeof definition.max === 'number' ? definition.max : 1,
          step: typeof definition.step === 'number' ? definition.step : 0.01,
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

function getVec2Value(value: unknown, parameterKey: string): EffectParamVec2Value {
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
      x: (value as EffectParamVec2Value).x,
      y: (value as EffectParamVec2Value).y,
    }
  }

  throw new Error(`效果参数不是有效二维向量: ${parameterKey}`)
}

function getColorValue(value: unknown, parameterKey: string): FilterParamColorValue {
  try {
    return normalizeFilterParamColor(value)
  } catch {
    throw new Error(`效果参数不是有效颜色: ${parameterKey}`)
  }
}
