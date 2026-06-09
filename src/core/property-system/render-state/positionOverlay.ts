import { reactive } from 'vue'
import { transformPositionSchema } from '@/core/property-system/schema'

interface PositionOverlayEntry {
  x?: number
  y?: number
}

const positionOverlays = reactive(new Map<string, PositionOverlayEntry>())

export function setTransformPositionOverlay(
  timelineItemId: string,
  patch: PositionOverlayEntry,
): void {
  if (!transformPositionSchema.supportsTransientOverlay) {
    throw new Error(`Transient overlay is not supported: ${transformPositionSchema.propertyId}`)
  }

  const current = positionOverlays.get(timelineItemId) ?? {}
  const nextEntry = {
    ...current,
    ...patch,
  }
  positionOverlays.set(timelineItemId, nextEntry)
}

export function getTransformPositionOverlay(timelineItemId: string): PositionOverlayEntry | undefined {
  return positionOverlays.get(timelineItemId)
}

export function clearTransformPositionOverlay(timelineItemId: string): void {
  positionOverlays.delete(timelineItemId)
}
