/**
 * 素材项目拖拽源处理器
 */

import type {
  DragSourceHandler,
  DragSourceType,
  AssetDragParams,
  MediaItemDragData,
  DragSourceParams,
  UnifiedDragData,
} from '@/core/types/drag'
import { DragSourceType as SourceType } from '@/core/types/drag'
import type { UnifiedMediaModule } from '@/core/modules/UnifiedMediaModule'
import type { UnifiedDirectoryModule } from '@/core/modules/UnifiedDirectoryModule'
import { isMediaAsset, isEffectTemplateAsset } from '@/core/asset/types'

function resolvePackageVersion(asset: ReturnType<UnifiedMediaModule['getAsset']>): string | undefined {
  if (!asset || !isEffectTemplateAsset(asset)) {
    return undefined
  }

  const payload = asset.templatePayload as { version?: unknown } | null | undefined
  return typeof payload?.version === 'string' ? payload.version : undefined
}

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
    const assetParams = params as AssetDragParams
    const assetId = assetParams.assetId
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
      effectPackageId: isEffectTemplateAsset(asset) ? asset.id : undefined,
      templateId: isEffectTemplateAsset(asset) ? asset.source.templateId : undefined,
      packageVersion: resolvePackageVersion(asset),
      catalogVersion: isEffectTemplateAsset(asset) ? asset.source.catalogVersion : undefined,
      sourceFolderId,
    }

    console.log(`📦 [MediaItemSourceHandler] 创建拖拽数据:`, dragData)

    return dragData
  }
}
