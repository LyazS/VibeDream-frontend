/**
 * 素材项目拖拽源处理器
 */

import type {
  DragSourceHandler,
  DragSourceType,
  AssetDragParams,
  MediaItemDragParams,
  MediaItemDragData,
  DragSourceParams,
  UnifiedDragData,
} from '@/core/types/drag'
import { DragSourceType as SourceType } from '@/core/types/drag'
import type { UnifiedMediaModule } from '@/core/modules/UnifiedMediaModule'
import type { UnifiedDirectoryModule } from '@/core/modules/UnifiedDirectoryModule'
import { isMediaAsset } from '@/core/asset/types'

export class MediaItemSourceHandler implements DragSourceHandler {
  readonly sourceType: DragSourceType = SourceType.ASSET

  constructor(
    private mediaModule: UnifiedMediaModule,
    private directoryModule: UnifiedDirectoryModule,
  ) {}

  createDragData(
    element: HTMLElement,
    event: DragEvent,
    params: DragSourceParams,
  ): UnifiedDragData {
    const assetParams = params as AssetDragParams | MediaItemDragParams

    const assetId = 'assetId' in assetParams ? assetParams.assetId : assetParams.mediaItemId
    const selectedAssetIds =
      'selectedAssetIds' in assetParams
        ? assetParams.selectedAssetIds
        : undefined

    const asset = this.mediaModule.getAsset(assetId)

    if (!asset) {
      throw new Error(`Asset not found: ${assetId}`)
    }

    // 从 directoryModule 获取当前文件夹信息
    const sourceFolderId = this.directoryModule.currentDir.value?.id

    const dragData: MediaItemDragData = {
      sourceType: SourceType.ASSET,
      timestamp: Date.now(),
      assetIds: selectedAssetIds || [assetId],
      assetId,
      name: asset.name,
      assetKind: asset.assetKind,
      duration: isMediaAsset(asset) ? asset.duration || 0 : undefined,
      mediaType: isMediaAsset(asset) ? asset.mediaType : undefined,
      effectType: !isMediaAsset(asset) ? asset.effectType : undefined,
      templatePayload: !isMediaAsset(asset) ? asset.templatePayload : undefined,
      mediaItemIds: isMediaAsset(asset) ? (selectedAssetIds || [assetId]) : undefined,
      mediaItemId: isMediaAsset(asset) ? assetId : undefined,
      sourceFolderId,
    }

    console.log(`📦 [MediaItemSourceHandler] 创建拖拽数据:`, dragData)

    return dragData
  }
}
