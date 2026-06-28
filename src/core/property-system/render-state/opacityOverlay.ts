import { reactive } from 'vue'
import { visualOpacitySchema } from '@/core/property-system/schema'

interface OpacityOverlayEntry {
  opacity: number
}

const opacityOverlays = reactive(new Map<string, OpacityOverlayEntry>())

function clampOpacity(opacity: number): number {
  return Math.min(1, Math.max(0, opacity))
}

export function setVisualOpacityOverlay(timelineItemId: string, opacity: number): void {
  if (!visualOpacitySchema.supportsTransientOverlay) {
    throw new Error(`Transient overlay is not supported: ${visualOpacitySchema.propertyId}`)
  }

  opacityOverlays.set(timelineItemId, {
    opacity: clampOpacity(opacity),
  })
}

export function getVisualOpacityOverlay(timelineItemId: string): OpacityOverlayEntry | undefined {
  return opacityOverlays.get(timelineItemId)
}

export function clearVisualOpacityOverlay(timelineItemId: string): void {
  opacityOverlays.delete(timelineItemId)
}
