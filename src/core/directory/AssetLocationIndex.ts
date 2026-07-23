/**
 * 媒体目录归属的非持久化索引。
 *
 * 持久化真相始终是 UnifiedMediaItemData.parentDirectoryId；该索引只用于
 * 高效列出某个目录中的素材，并在加载、创建、移动、删除时同步更新。
 */
export class AssetLocationIndex {
  private readonly directoryByAssetId = new Map<string, string>()
  private readonly assetIdsByDirectoryId = new Map<string, Set<string>>()

  clear(): void {
    this.directoryByAssetId.clear()
    this.assetIdsByDirectoryId.clear()
  }

  register(assetId: string, directoryId: string): void {
    const existingDirectoryId = this.directoryByAssetId.get(assetId)
    if (existingDirectoryId && existingDirectoryId !== directoryId) {
      throw new Error(`素材 ${assetId} 已登记在目录 ${existingDirectoryId}`)
    }

    this.directoryByAssetId.set(assetId, directoryId)
    let assetIds = this.assetIdsByDirectoryId.get(directoryId)
    if (!assetIds) {
      assetIds = new Set()
      this.assetIdsByDirectoryId.set(directoryId, assetIds)
    }
    assetIds.add(assetId)
  }

  move(assetId: string, targetDirectoryId: string): void {
    const sourceDirectoryId = this.directoryByAssetId.get(assetId)
    if (!sourceDirectoryId) {
      throw new Error(`素材 ${assetId} 尚未登记目录归属`)
    }
    if (sourceDirectoryId === targetDirectoryId) {
      return
    }

    const sourceAssetIds = this.assetIdsByDirectoryId.get(sourceDirectoryId)
    sourceAssetIds?.delete(assetId)
    if (sourceAssetIds?.size === 0) {
      this.assetIdsByDirectoryId.delete(sourceDirectoryId)
    }

    this.directoryByAssetId.set(assetId, targetDirectoryId)
    let targetAssetIds = this.assetIdsByDirectoryId.get(targetDirectoryId)
    if (!targetAssetIds) {
      targetAssetIds = new Set()
      this.assetIdsByDirectoryId.set(targetDirectoryId, targetAssetIds)
    }
    targetAssetIds.add(assetId)
  }

  remove(assetId: string): string | null {
    const directoryId = this.directoryByAssetId.get(assetId)
    if (!directoryId) {
      return null
    }

    this.directoryByAssetId.delete(assetId)
    const assetIds = this.assetIdsByDirectoryId.get(directoryId)
    assetIds?.delete(assetId)
    if (assetIds?.size === 0) {
      this.assetIdsByDirectoryId.delete(directoryId)
    }
    return directoryId
  }

  getDirectoryId(assetId: string): string | null {
    return this.directoryByAssetId.get(assetId) ?? null
  }

  getAssetIds(directoryId: string): string[] {
    return [...(this.assetIdsByDirectoryId.get(directoryId) ?? [])]
  }
}

export interface AssetWithDirectoryLocation {
  parentDirectoryId: string
}

export async function persistAssetDirectoryMove<T extends AssetWithDirectoryLocation>(
  asset: T,
  targetDirectoryId: string,
  persist: (asset: T) => Promise<boolean>,
): Promise<boolean> {
  const sourceDirectoryId = asset.parentDirectoryId
  if (sourceDirectoryId === targetDirectoryId) {
    return true
  }

  asset.parentDirectoryId = targetDirectoryId
  const saved = await persist(asset)
  if (saved) {
    return true
  }

  asset.parentDirectoryId = sourceDirectoryId
  return false
}
