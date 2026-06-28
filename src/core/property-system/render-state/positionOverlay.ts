import { reactive } from 'vue'
import { visualPositionSchema } from '@/core/property-system/schema'

interface PositionOverlayEntry {
  x?: number
  y?: number
}

const positionOverlays = reactive(new Map<string, PositionOverlayEntry>())

export function setVisualPositionOverlay(
  timelineItemId: string,
  patch: PositionOverlayEntry,
): void {
  if (!visualPositionSchema.supportsTransientOverlay) {
    throw new Error(`Transient overlay is not supported: ${visualPositionSchema.propertyId}`)
  }

  const current = positionOverlays.get(timelineItemId) ?? {}
  const nextEntry = {
    ...current,
    ...patch,
  }
  positionOverlays.set(timelineItemId, nextEntry)
}

export function getVisualPositionOverlay(timelineItemId: string): PositionOverlayEntry | undefined {
  return positionOverlays.get(timelineItemId)
}

export function clearVisualPositionOverlay(timelineItemId: string): void {
  positionOverlays.delete(timelineItemId)
}
