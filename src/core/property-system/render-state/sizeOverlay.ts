import { reactive } from 'vue'
import { visualSizeSchema } from '../schema/animatablePropertySchemas'

interface SizeOverlayEntry {
  width?: number
  height?: number
}

const sizeOverlays = reactive(new Map<string, SizeOverlayEntry>())

export function setVisualSizeOverlay(timelineItemId: string, patch: SizeOverlayEntry): void {
  if (!visualSizeSchema.supportsTransientOverlay) {
    throw new Error(`Transient overlay is not supported: ${visualSizeSchema.propertyId}`)
  }

  const current = sizeOverlays.get(timelineItemId) ?? {}
  sizeOverlays.set(timelineItemId, {
    ...current,
    ...patch,
  })
}

export function getVisualSizeOverlay(timelineItemId: string): SizeOverlayEntry | undefined {
  return sizeOverlays.get(timelineItemId)
}

export function clearVisualSizeOverlay(timelineItemId: string): void {
  sizeOverlays.delete(timelineItemId)
}
