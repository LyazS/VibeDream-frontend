import { reactive } from 'vue'
import { maskCenterSchema } from '../schema/animatablePropertySchemas'

interface MaskCenterOverlayEntry {
  centerX?: number
  centerY?: number
}

const maskCenterOverlays = reactive(new Map<string, MaskCenterOverlayEntry>())

export function setMaskCenterOverlay(timelineItemId: string, patch: MaskCenterOverlayEntry): void {
  if (!maskCenterSchema.supportsTransientOverlay) {
    throw new Error(`Transient overlay is not supported: ${maskCenterSchema.propertyId}`)
  }

  const current = maskCenterOverlays.get(timelineItemId) ?? {}
  maskCenterOverlays.set(timelineItemId, {
    ...current,
    ...patch,
  })
}

export function getMaskCenterOverlay(timelineItemId: string): MaskCenterOverlayEntry | undefined {
  return maskCenterOverlays.get(timelineItemId)
}

export function clearMaskCenterOverlay(timelineItemId: string): void {
  maskCenterOverlays.delete(timelineItemId)
}
