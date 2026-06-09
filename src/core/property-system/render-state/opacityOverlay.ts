import { reactive } from 'vue'
import { transformOpacitySchema } from '@/core/property-system/schema'

interface OpacityOverlayEntry {
  opacity: number
}

const opacityOverlays = reactive(new Map<string, OpacityOverlayEntry>())

function clampOpacity(opacity: number): number {
  return Math.min(1, Math.max(0, opacity))
}

export function setTransformOpacityOverlay(timelineItemId: string, opacity: number): void {
  if (!transformOpacitySchema.supportsTransientOverlay) {
    throw new Error(`Transient overlay is not supported: ${transformOpacitySchema.propertyId}`)
  }

  opacityOverlays.set(timelineItemId, {
    opacity: clampOpacity(opacity),
  })
}

export function getTransformOpacityOverlay(timelineItemId: string): OpacityOverlayEntry | undefined {
  return opacityOverlays.get(timelineItemId)
}

export function clearTransformOpacityOverlay(timelineItemId: string): void {
  opacityOverlays.delete(timelineItemId)
}
