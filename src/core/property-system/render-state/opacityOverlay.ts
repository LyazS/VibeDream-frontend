import { reactive } from 'vue'
import { visualBlendIntensitySchema } from '../schema/animatablePropertySchemas'

interface BlendIntensityOverlayEntry {
  blendIntensity: number
}

const blendIntensityOverlays = reactive(new Map<string, BlendIntensityOverlayEntry>())

function clampBlendIntensity(blendIntensity: number): number {
  return Math.min(1, Math.max(0, blendIntensity))
}

export function setVisualBlendIntensityOverlay(
  timelineItemId: string,
  blendIntensity: number,
): void {
  if (!visualBlendIntensitySchema.supportsTransientOverlay) {
    throw new Error(`Transient overlay is not supported: ${visualBlendIntensitySchema.propertyId}`)
  }

  blendIntensityOverlays.set(timelineItemId, {
    blendIntensity: clampBlendIntensity(blendIntensity),
  })
}

export function getVisualBlendIntensityOverlay(
  timelineItemId: string,
): BlendIntensityOverlayEntry | undefined {
  return blendIntensityOverlays.get(timelineItemId)
}

export function clearVisualBlendIntensityOverlay(timelineItemId: string): void {
  blendIntensityOverlays.delete(timelineItemId)
}
