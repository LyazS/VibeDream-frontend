import { reactive } from 'vue'
import { filterIntensitySchema } from '@/core/property-system/schema'

interface FilterIntensityOverlayEntry {
  intensity: number
}

const filterIntensityOverlays = reactive(new Map<string, FilterIntensityOverlayEntry>())

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

export function getFilterIntensityOverlay(timelineItemId: string): FilterIntensityOverlayEntry | undefined {
  return filterIntensityOverlays.get(timelineItemId)
}

export function clearFilterIntensityOverlay(timelineItemId: string): void {
  filterIntensityOverlays.delete(timelineItemId)
}
