import type { UnifiedMediaItemData } from '@/core/mediaitem/types'

export type AssetKind = 'media'

export type MediaLibraryAssetData = UnifiedMediaItemData & {
  assetKind: 'media'
}

export type UnifiedLibraryAssetData = MediaLibraryAssetData

export function isMediaAsset(
  asset: UnifiedLibraryAssetData | null | undefined,
): asset is MediaLibraryAssetData {
  return asset?.assetKind === 'media'
}
