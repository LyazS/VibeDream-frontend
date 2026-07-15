import { reactive } from 'vue'
import { maskEllipseSizeSchema, maskRectangleSizeSchema } from '@/core/property-system/schema'

interface MaskRectangleSizeOverlayEntry {
  width?: number
  height?: number
}

interface MaskEllipseSizeOverlayEntry {
  ellipseWidth?: number
  ellipseHeight?: number
}

const maskRectangleSizeOverlays = reactive(new Map<string, MaskRectangleSizeOverlayEntry>())
const maskEllipseSizeOverlays = reactive(new Map<string, MaskEllipseSizeOverlayEntry>())

export function setMaskRectangleSizeOverlay(
  timelineItemId: string,
  patch: MaskRectangleSizeOverlayEntry,
): void {
  if (!maskRectangleSizeSchema.supportsTransientOverlay) {
    throw new Error(`Transient overlay is not supported: ${maskRectangleSizeSchema.propertyId}`)
  }

  const current = maskRectangleSizeOverlays.get(timelineItemId) ?? {}
  maskRectangleSizeOverlays.set(timelineItemId, {
    ...current,
    ...patch,
  })
}

export function getMaskRectangleSizeOverlay(
  timelineItemId: string,
): MaskRectangleSizeOverlayEntry | undefined {
  return maskRectangleSizeOverlays.get(timelineItemId)
}

export function clearMaskRectangleSizeOverlay(timelineItemId: string): void {
  maskRectangleSizeOverlays.delete(timelineItemId)
}

export function setMaskEllipseSizeOverlay(
  timelineItemId: string,
  patch: MaskEllipseSizeOverlayEntry,
): void {
  if (!maskEllipseSizeSchema.supportsTransientOverlay) {
    throw new Error(`Transient overlay is not supported: ${maskEllipseSizeSchema.propertyId}`)
  }

  const current = maskEllipseSizeOverlays.get(timelineItemId) ?? {}
  maskEllipseSizeOverlays.set(timelineItemId, {
    ...current,
    ...patch,
  })
}

export function getMaskEllipseSizeOverlay(
  timelineItemId: string,
): MaskEllipseSizeOverlayEntry | undefined {
  return maskEllipseSizeOverlays.get(timelineItemId)
}

export function clearMaskEllipseSizeOverlay(timelineItemId: string): void {
  maskEllipseSizeOverlays.delete(timelineItemId)
}
