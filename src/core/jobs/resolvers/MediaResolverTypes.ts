import type { UnifiedMediaItemData, MediaType } from '@/core/mediaitem/types'

export interface MediaResolverOptions {
  getMediaItem(mediaId: string): UnifiedMediaItemData | undefined
}

export interface MediaFileAvailableInput {
  mediaId: string
}

export interface MediaFileAvailableResult {
  mediaItem: UnifiedMediaItemData
  file: File
  mediaType: MediaType | null
}

export interface MediaDecodedInput {
  mediaId: string
}
