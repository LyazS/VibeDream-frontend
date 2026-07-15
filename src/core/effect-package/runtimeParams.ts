import { normalizeFilterParamColor } from '@/core/filter/color'
import type { AnyEffectPackagePayload } from '@/core/effect-package/types'

export function normalizeEffectRuntimeParams(
  payload: AnyEffectPackagePayload,
  params: Record<string, unknown>,
): Record<string, unknown> {
  const nextParams = { ...params }

  for (const [parameterKey, definition] of Object.entries(payload.parameterSchema)) {
    if (!(parameterKey in nextParams)) {
      continue
    }

    if (definition.type === 'color') {
      nextParams[parameterKey] = normalizeFilterParamColor(nextParams[parameterKey])
    }
  }

  return nextParams
}
