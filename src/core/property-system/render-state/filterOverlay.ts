import { reactive } from 'vue'
import { filterIntensitySchema } from '../schema/animatablePropertySchemas'

interface FilterIntensityOverlayEntry {
  intensity: number
}

interface FilterParamOverlayEntry {
  params: Record<string, unknown>
}

const filterIntensityOverlays = reactive(new Map<string, FilterIntensityOverlayEntry>())
const filterParamOverlays = reactive(new Map<string, FilterParamOverlayEntry>())

function clampIntensity(intensity: number): number {
  return Math.min(1, Math.max(0, intensity))
}

export function setFilterIntensityOverlay(timelineItemId: string, intensity: number): void {
  if (!filterIntensitySchema.supportsTransientOverlay) {
    throw new Error(`Transient overlay is not supported: ${filterIntensitySchema.propertyId}`)
  }

  filterIntensityOverlays.set(timelineItemId, {
    intensity: clampIntensity(intensity),
  })
}

export function getFilterIntensityOverlay(
  timelineItemId: string,
): FilterIntensityOverlayEntry | undefined {
  return filterIntensityOverlays.get(timelineItemId)
}

export function clearFilterIntensityOverlay(timelineItemId: string): void {
  filterIntensityOverlays.delete(timelineItemId)
}

export function setFilterParamOverlay(
  timelineItemId: string,
  parameterKey: string,
  value: unknown,
): void {
  const current = filterParamOverlays.get(timelineItemId)?.params ?? {}
  filterParamOverlays.set(timelineItemId, {
    params: {
      ...current,
      [parameterKey]: value,
    },
  })
}

export function getFilterParamOverlay(timelineItemId: string): FilterParamOverlayEntry | undefined {
  return filterParamOverlays.get(timelineItemId)
}

export function clearFilterParamOverlay(timelineItemId: string, parameterKey?: string): void {
  if (!parameterKey) {
    filterParamOverlays.delete(timelineItemId)
    return
  }

  const current = filterParamOverlays.get(timelineItemId)
  if (!current) return

  const nextParams = { ...current.params }
  delete nextParams[parameterKey]

  if (Object.keys(nextParams).length === 0) {
    filterParamOverlays.delete(timelineItemId)
    return
  }

  filterParamOverlays.set(timelineItemId, { params: nextParams })
}

export function clearFilterOverlays(timelineItemId: string): void {
  clearFilterIntensityOverlay(timelineItemId)
  clearFilterParamOverlay(timelineItemId)
}
