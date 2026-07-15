export const BLEND_MODE_VALUES = [
  'normal',
  'color-dodge',
  'linear-burn',
  'hard-light',
  'multiply',
  'color-burn',
  'overlay',
  'lighten',
  'darken',
  'soft-light',
  'screen',
] as const

export type BlendMode = (typeof BLEND_MODE_VALUES)[number]

export const DEFAULT_BLEND_MODE: BlendMode = 'normal'

export const BLEND_MODE_UNIFORM_VALUES: Record<BlendMode, number> = {
  normal: 0,
  'color-dodge': 1,
  'linear-burn': 2,
  'hard-light': 3,
  multiply: 4,
  'color-burn': 5,
  overlay: 6,
  lighten: 7,
  darken: 8,
  'soft-light': 9,
  screen: 10,
}

export const BLEND_MODE_HISTORY_LABELS: Record<BlendMode, string> = {
  normal: '正常',
  'color-dodge': '颜色减淡',
  'linear-burn': '线性加深',
  'hard-light': '强光',
  multiply: '正片叠底',
  'color-burn': '颜色加深',
  overlay: '叠加',
  lighten: '变亮',
  darken: '变暗',
  'soft-light': '柔光',
  screen: '滤色',
}

export function isBlendMode(value: unknown): value is BlendMode {
  return typeof value === 'string' && BLEND_MODE_VALUES.includes(value as BlendMode)
}
