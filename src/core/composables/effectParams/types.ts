import type { FilterParamColorValue } from '@/core/filter/color'
import type { EffectPackageParameterDefinition } from '@/core/effect-package/types'

export interface EffectParamVec2Value {
  x: number
  y: number
}

export interface EffectParamVec3Value extends EffectParamVec2Value {
  z: number
}

export interface EffectParamVec4Value extends EffectParamVec3Value {
  w: number
}

export type DynamicEffectParamViewModel =
  | {
      kind: 'float' | 'int'
      parameterKey: string
      label: string
      value: number
      min: number
      max: number
      step: number
      precision: number
    }
  | {
      kind: 'vec2' | 'ivec2'
      parameterKey: string
      label: string
      value: EffectParamVec2Value
      min: number
      max: number
      step: number
      precision: number
    }
  | {
      kind: 'vec3'
      parameterKey: string
      label: string
      value: EffectParamVec3Value
      min: number
      max: number
      step: number
      precision: number
    }
  | {
      kind: 'vec4'
      parameterKey: string
      label: string
      value: EffectParamVec4Value
      min: number
      max: number
      step: number
      precision: number
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
