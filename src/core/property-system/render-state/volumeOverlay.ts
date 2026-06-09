import { reactive } from 'vue'
import { audioVolumeSchema } from '@/core/property-system/schema'

interface VolumeOverlayEntry {
  volume: number
}

const volumeOverlays = reactive(new Map<string, VolumeOverlayEntry>())

function clampVolume(volume: number): number {
  return Math.min(1, Math.max(0, volume))
}

export function setAudioVolumeOverlay(timelineItemId: string, volume: number): void {
  if (!audioVolumeSchema.supportsTransientOverlay) {
    throw new Error(`Transient overlay is not supported: ${audioVolumeSchema.propertyId}`)
  }

  volumeOverlays.set(timelineItemId, {
    volume: clampVolume(volume),
  })
}

export function getAudioVolumeOverlay(timelineItemId: string): VolumeOverlayEntry | undefined {
  return volumeOverlays.get(timelineItemId)
}

export function clearAudioVolumeOverlay(timelineItemId: string): void {
  volumeOverlays.delete(timelineItemId)
}
