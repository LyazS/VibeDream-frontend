import type { FilterParamColorValue } from '@/core/filter/color'
import type { EffectPackageParameterDefinition } from '@/core/effect-package/types'

export interface EffectParamVec2Value {
  x: number
  y: number
}

export type DynamicEffectParamViewModel =
  | {
      kind: 'number'
      parameterKey: string
      label: string
      value: number
      min: number
      max: number
      step: number
    }
  | {
      kind: 'vec2'
      parameterKey: string
      label: string
      value: EffectParamVec2Value
      min: number
      max: number
      step: number
    }
  | {
      kind: 'color'
      parameterKey: string
      label: string
      value: FilterParamColorValue
    }
  | {
      kind: 'boolean'
      parameterKey: string
      label: string
      value: boolean
    }

export type EffectParameterSchema = Record<string, EffectPackageParameterDefinition>
