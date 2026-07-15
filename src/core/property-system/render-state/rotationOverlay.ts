import { reactive } from 'vue'
import { visualRotationSchema } from '../schema/animatablePropertySchemas'

interface RotationOverlayEntry {
  rotation: number
}

const rotationOverlays = reactive(new Map<string, RotationOverlayEntry>())

export function setVisualRotationOverlay(timelineItemId: string, rotation: number): void {
  if (!visualRotationSchema.supportsTransientOverlay) {
    throw new Error(`Transient overlay is not supported: ${visualRotationSchema.propertyId}`)
  }

  rotationOverlays.set(timelineItemId, {
    rotation,
  })
}

export function getVisualRotationOverlay(timelineItemId: string): RotationOverlayEntry | undefined {
  return rotationOverlays.get(timelineItemId)
}

export function clearVisualRotationOverlay(timelineItemId: string): void {
  rotationOverlays.delete(timelineItemId)
}
