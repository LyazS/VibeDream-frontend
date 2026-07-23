export interface LibraryRevealTab {
  id: string
  dirId: string
}

export interface LibraryRevealCoordinator {
  getAssetDirectoryId: (assetId: string) => string | null
  getOpenTabs: () => LibraryRevealTab[]
  hasActiveTab: () => boolean
  switchTab: (tabId: string) => boolean
  navigateToDir: (dirId: string) => boolean
  openTab: (dirId: string, switchToNewTab: boolean) => void
  setMediaSection: () => void
  selectAsset: (assetId: string) => void
  requestScrollAndHighlight: (assetId: string) => void
}

export type RevealMediaInLibraryResult =
  | { success: true; directoryId: string }
  | { success: false; error: 'asset_or_directory_not_found' }

/**
 * 协调素材库定位，不向时间线数据写入任何目录信息。
 */
export function revealMediaInLibrary(
  mediaId: string,
  coordinator: LibraryRevealCoordinator,
): RevealMediaInLibraryResult {
  const directoryId = coordinator.getAssetDirectoryId(mediaId)
  if (!directoryId) {
    return { success: false, error: 'asset_or_directory_not_found' }
  }

  coordinator.setMediaSection()
  const targetTab = coordinator.getOpenTabs().find((tab) => tab.dirId === directoryId)
  if (targetTab) {
    coordinator.switchTab(targetTab.id)
  } else if (coordinator.hasActiveTab()) {
    coordinator.navigateToDir(directoryId)
  } else {
    coordinator.openTab(directoryId, true)
  }

  coordinator.selectAsset(mediaId)
  coordinator.requestScrollAndHighlight(mediaId)
  return { success: true, directoryId }
}
