import { ref, type Ref } from 'vue'
import type { ModuleRegistry } from './ModuleRegistry'

export type PropertyTabKey = 'basic' | 'animation'
export type LibrarySectionKey = 'media'
export type AIPanelTabKey = 'agent' | 'media-search-test' | 'item-property-test'

export interface LibraryRevealRequest {
  assetId: string
  requestId: number
}

export function createUnifiedUIModule(_registry: ModuleRegistry): {
  isChatPanelVisible: Ref<boolean>
  aiPanelActiveTab: Ref<AIPanelTabKey>
  librarySection: Ref<LibrarySectionKey>
  libraryRevealRequest: Ref<LibraryRevealRequest | null>
  activePropertyTab: Ref<PropertyTabKey>
  setChatPanelVisible: (visible: boolean) => void
  setLibrarySection: (section: LibrarySectionKey) => void
  requestLibraryAssetReveal: (assetId: string) => void
  setActivePropertyTab: (tab: PropertyTabKey) => void
} {
  const isChatPanelVisible = ref(true)
  const aiPanelActiveTab = ref<AIPanelTabKey>('agent')
  const librarySection = ref<LibrarySectionKey>('media')
  const libraryRevealRequest = ref<LibraryRevealRequest | null>(null)
  let libraryRevealRequestId = 0
  const activePropertyTab = ref<PropertyTabKey>('basic')

  function setChatPanelVisible(visible: boolean): void {
    isChatPanelVisible.value = visible
  }

  function setLibrarySection(section: LibrarySectionKey): void {
    librarySection.value = section
  }

  function requestLibraryAssetReveal(assetId: string): void {
    libraryRevealRequest.value = {
      assetId,
      requestId: ++libraryRevealRequestId,
    }
  }

  function setActivePropertyTab(tab: PropertyTabKey): void {
    activePropertyTab.value = tab
  }

  return {
    isChatPanelVisible,
    aiPanelActiveTab,
    librarySection,
    libraryRevealRequest,
    activePropertyTab,
    setChatPanelVisible,
    setLibrarySection,
    requestLibraryAssetReveal,
    setActivePropertyTab,
  }
}

export type UnifiedUIModule = ReturnType<typeof createUnifiedUIModule>
