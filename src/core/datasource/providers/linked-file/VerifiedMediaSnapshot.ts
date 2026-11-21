import { BunnyProcessor, disposeBunnyObjects } from '@/core/bunnyUtils/BunnyProcessor'
import type { UnifiedMediaItemData } from '@/core/mediaitem/types'

const processor = new BunnyProcessor()
const verifiedFiles = new WeakMap<UnifiedMediaItemData, File>()

/** Decode the verified File into an isolated runtime for this read, independent of the preview. */
export async function decodeVerifiedMedia<T extends UnifiedMediaItemData>(
  media: T,
  file: File,
): Promise<T> {
  const snapshot: T = { ...media, runtime: {} }
  try {
    const decoded = await processor.processMedia(snapshot, file, { thumbnail: false })
    snapshot.mediaStatus = 'ready'
    snapshot.duration = Number(decoded.durationN)
    verifiedFiles.set(snapshot, file)
    return snapshot
  } catch (error) {
    await disposeBunnyObjects(snapshot.runtime.bunny).catch(() => {})
    throw error
  }
}

export function getVerifiedMediaFile(media: UnifiedMediaItemData) {
  return verifiedFiles.get(media)
}

export async function disposeVerifiedMedia(media: UnifiedMediaItemData) {
  verifiedFiles.delete(media)
  await disposeBunnyObjects(media.runtime.bunny)
}
