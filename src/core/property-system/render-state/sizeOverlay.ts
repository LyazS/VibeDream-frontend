import { reactive } from 'vue'
import { transformSizeSchema } from '@/core/property-system/schema'

interface SizeOverlayEntry {
  width?: number
  height?: number
}

const sizeOverlays = reactive(new Map<string, SizeOverlayEntry>())

export function setTransformSizeOverlay(
  timelineItemId: string,
  patch: SizeOverlayEntry,
): void {
  if (!transformSizeSchema.supportsTransientOverlay) {
    throw new Error(`Transient overlay is not supported: ${transformSizeSchema.propertyId}`)
  }

  const current = sizeOverlays.get(timelineItemId) ?? {}
  sizeOverlays.set(timelineItemId, {
    ...current,
    ...patch,
  })
}

export function getTransformSizeOverlay(timelineItemId: string): SizeOverlayEntry | undefined {
  return sizeOverlays.get(timelineItemId)
}

export function clearTransformSizeOverlay(timelineItemId: string): void {
  sizeOverlays.delete(timelineItemId)
}
