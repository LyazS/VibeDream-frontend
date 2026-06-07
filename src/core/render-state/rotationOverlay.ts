import { reactive } from 'vue'
import { normalizeAngle } from '@/core/utils/rotationTransform'
import { transformRotationSchema } from '@/core/property-schema'

interface RotationOverlayEntry {
  rotation: number
}

const rotationOverlays = reactive(new Map<string, RotationOverlayEntry>())

export function setTransformRotationOverlay(timelineItemId: string, rotation: number): void {
  if (!transformRotationSchema.supportsTransientOverlay) {
    throw new Error(`Transient overlay is not supported: ${transformRotationSchema.propertyId}`)
  }

  rotationOverlays.set(timelineItemId, {
    rotation: normalizeAngle(rotation),
  })
}

export function getTransformRotationOverlay(timelineItemId: string): RotationOverlayEntry | undefined {
  return rotationOverlays.get(timelineItemId)
}

export function clearTransformRotationOverlay(timelineItemId: string): void {
  rotationOverlays.delete(timelineItemId)
}
