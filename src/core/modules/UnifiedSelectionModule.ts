import { ref, computed } from 'vue'
import type { UnifiedTimelineItemData } from '@/core/timelineitem/model/timelineItem'
import type { ModuleRegistry } from './ModuleRegistry'
import { MODULE_NAMES } from './ModuleRegistry'
import type { UnifiedTimelineModule } from './UnifiedTimelineModule'
import type { UnifiedDirectoryModule } from './UnifiedDirectoryModule'
import type { UnifiedMediaModule } from './UnifiedMediaModule'
import type { DisplayItem } from '@/core/directory/types'
import {
  buildClipSelectionId,
  parseTimelineSelectionId,
  type TimelineSelectionId,
} from '@/core/types/timelineSelection'

export type SelectionItemType = 'timeline-selection' | 'library-asset'
export type SelectionMode = 'replace' | 'toggle' | 'range'

export function createUnifiedSelectionModule(registry: ModuleRegistry) {
  const timelineModule = registry.get<UnifiedTimelineModule>(MODULE_NAMES.TIMELINE)
  const directoryModule = registry.get<UnifiedDirectoryModule>(MODULE_NAMES.DIRECTORY)
  const mediaModule = registry.get<UnifiedMediaModule>(MODULE_NAMES.MEDIA)
  const getTimelineItem = (id: string) => timelineModule.getTimelineItem(id)

  const selectedTimelineSelectionIds = ref<Set<TimelineSelectionId>>(new Set())
  const lastSelectedTimelineSelectionId = ref<TimelineSelectionId | null>(null)
  const selectedLibraryAssetIds = ref<Set<string>>(new Set())
  const lastSelectedLibraryAssetId = ref<string | null>(null)

  const selectedTimelineSelectionId = computed(() =>
    selectedTimelineSelectionIds.value.size === 1
      ? Array.from(selectedTimelineSelectionIds.value)[0]
      : null,
  )
  const isTimelineSelectionMultiSelectMode = computed(
    () => selectedTimelineSelectionIds.value.size > 1,
  )
  const hasSelection = computed(() => selectedTimelineSelectionIds.value.size > 0)
  const selectedClipTimelineItemIds = computed(() =>
    Array.from(selectedTimelineSelectionIds.value).flatMap((selectionId) => {
      const parsed = parseTimelineSelectionId(selectionId)
      return parsed ? [parsed.sourceId] : []
    }),
  )
  const selectedClipTimelineItemId = computed(() => {
    const parsed = parseTimelineSelectionId(selectedTimelineSelectionId.value)
    return parsed?.sourceId ?? null
  })
  const selectedLibraryAssetId = computed(() =>
    selectedLibraryAssetIds.value.size === 1
      ? Array.from(selectedLibraryAssetIds.value)[0]
      : null,
  )
  const isLibraryAssetMultiSelectMode = computed(() => selectedLibraryAssetIds.value.size > 1)
  const hasLibraryAssetSelection = computed(() => selectedLibraryAssetIds.value.size > 0)

  function applySelection<T extends string>(
    targetSet: Set<T>,
    itemIds: T[],
    mode: Exclude<SelectionMode, 'range'>,
  ) {
    if (mode === 'replace') {
      targetSet.clear()
      itemIds.forEach((id) => targetSet.add(id))
      return
    }

    itemIds.forEach((id) => {
      if (targetSet.has(id)) targetSet.delete(id)
      else targetSet.add(id)
    })
  }

  function selectTimelineItems(itemIds: TimelineSelectionId[], mode: SelectionMode = 'replace') {
    if (selectedLibraryAssetIds.value.size > 0) {
      selectedLibraryAssetIds.value.clear()
      lastSelectedLibraryAssetId.value = null
    }
    if (mode === 'range') {
      console.warn('⚠️ 时间轴选择不支持范围选择模式')
      return
    }

    applySelection(selectedTimelineSelectionIds.value, itemIds, mode)
    if (selectedTimelineSelectionIds.value.size === 0) {
      lastSelectedTimelineSelectionId.value = null
    } else if (itemIds.length > 0) {
      lastSelectedTimelineSelectionId.value = itemIds[itemIds.length - 1]
    }
  }

  function selectLibraryItems(itemIds: string[], mode: SelectionMode = 'replace') {
    if (selectedTimelineSelectionIds.value.size > 0) {
      selectedTimelineSelectionIds.value.clear()
      lastSelectedTimelineSelectionId.value = null
    }
    if (mode === 'range') {
      handleLibraryAssetRangeSelection(itemIds[0])
      return
    }

    applySelection(selectedLibraryAssetIds.value, itemIds, mode)
    if (selectedLibraryAssetIds.value.size === 0) {
      lastSelectedLibraryAssetId.value = null
    } else if (itemIds.length > 0) {
      lastSelectedLibraryAssetId.value = itemIds[itemIds.length - 1]
    }
  }

  function handleLibraryAssetRangeSelection(endItemId: string) {
    const allItems = getOrderedDisplayItems()
    if (!allItems.length) return

    const startItemId = lastSelectedLibraryAssetId.value
    if (!startItemId) {
      selectLibraryItems([endItemId], 'replace')
      return
    }

    const startIndex = allItems.findIndex((item) => item.id === startItemId)
    const endIndex = allItems.findIndex((item) => item.id === endItemId)
    if (startIndex === -1 || endIndex === -1) {
      selectLibraryItems([endItemId], 'replace')
      return
    }

    const minIndex = Math.min(startIndex, endIndex)
    const maxIndex = Math.max(startIndex, endIndex)
    selectLibraryItems(
      allItems.slice(minIndex, maxIndex + 1).map((item) => item.id),
      'replace',
    )
  }

  function sortDisplayItems(
    items: DisplayItem[],
    sortBy: 'name' | 'date' | 'type',
    sortOrder: 'asc' | 'desc',
  ): DisplayItem[] {
    const sorted = [...items]
    sorted.sort((a, b) => {
      if (a.type === 'directory' && b.type !== 'directory') return -1
      if (a.type !== 'directory' && b.type === 'directory') return 1

      let comparison = 0
      if (a.type === 'directory' && b.type === 'directory') {
        const dirA = directoryModule.getDirectory(a.id)
        const dirB = directoryModule.getDirectory(b.id)
        comparison = (dirA?.name || '').localeCompare(dirB?.name || '', 'zh-CN')
      } else if (a.type === 'asset' && b.type === 'asset') {
        const mediaA = mediaModule.getAsset(a.id)
        const mediaB = mediaModule.getAsset(b.id)
        if (!mediaA || !mediaB) return 0

        if (sortBy === 'name') comparison = mediaA.name.localeCompare(mediaB.name, 'zh-CN')
        if (sortBy === 'date') comparison = mediaA.createdAt.localeCompare(mediaB.createdAt)
        if (sortBy === 'type') {
          comparison = `media-${mediaA.mediaType}`.localeCompare(`media-${mediaB.mediaType}`)
          if (comparison === 0) comparison = mediaA.name.localeCompare(mediaB.name, 'zh-CN')
        }
      }

      return sortOrder === 'asc' ? comparison : -comparison
    })
    return sorted
  }

  function getOrderedDisplayItems(): DisplayItem[] {
    const currentDir = directoryModule.currentDir.value
    if (!currentDir) return []
    return sortDisplayItems(
      directoryModule.getDirectoryContent(currentDir.id),
      directoryModule.sortBy.value,
      directoryModule.sortOrder.value,
    )
  }

  function selectTimelineSelections(
    itemIds: TimelineSelectionId[],
    mode: 'replace' | 'toggle' = 'replace',
  ) {
    return selectTimelineItems(itemIds, mode)
  }

  function selectTimelineSelection(selectionId: TimelineSelectionId | null) {
    selectTimelineSelections(selectionId ? [selectionId] : [], 'replace')
  }

  function selectLibraryAssets(itemIds: string[], mode: SelectionMode = 'replace') {
    return selectLibraryItems(itemIds, mode)
  }

  function selectLibraryAsset(libraryAssetId: string | null) {
    selectLibraryAssets(libraryAssetId ? [libraryAssetId] : [], 'replace')
  }

  function isLibraryAssetSelected(libraryAssetId: string): boolean {
    return selectedLibraryAssetIds.value.has(libraryAssetId)
  }

  function isTimelineSelectionSelected(selectionId: TimelineSelectionId): boolean {
    return selectedTimelineSelectionIds.value.has(selectionId)
  }

  function clearTimelineSelection() {
    selectedTimelineSelectionIds.value.clear()
    lastSelectedTimelineSelectionId.value = null
  }

  function clearLibraryAssetSelection() {
    selectedLibraryAssetIds.value.clear()
    lastSelectedLibraryAssetId.value = null
  }

  function clearAllSelections() {
    clearTimelineSelection()
    clearLibraryAssetSelection()
  }

  function clearSelectionsForTimelineItem(timelineItemId: string) {
    selectedTimelineSelectionIds.value.delete(buildClipSelectionId(timelineItemId))
    if (selectedTimelineSelectionIds.value.size === 0) {
      lastSelectedTimelineSelectionId.value = null
    }
  }

  function getSelectedClipTimelineItem(): UnifiedTimelineItemData | null {
    if (!selectedClipTimelineItemId.value) return null
    return getTimelineItem(selectedClipTimelineItemId.value) || null
  }

  function getSelectionSummary() {
    const selectedClip = getSelectedClipTimelineItem()
    return {
      hasTimelineSelection: hasSelection.value,
      selectedTimelineSelectionId: selectedTimelineSelectionId.value,
      selectedClipTimelineItemId: selectedClipTimelineItemId.value,
      selectedClipTimelineItem: selectedClip
        ? {
            id: selectedClip.id,
            mediaItemId: selectedClip.mediaItemId,
            trackId: selectedClip.trackId,
            startTime: selectedClip.timeRange.timelineStartTime / 1000000,
            endTime: selectedClip.timeRange.timelineEndTime / 1000000,
          }
        : null,
    }
  }

  function resetToDefaults() {
    clearAllSelections()
  }

  return {
    selectedTimelineSelectionId,
    selectedTimelineSelectionIds,
    isTimelineSelectionMultiSelectMode,
    hasSelection,
    selectedClipTimelineItemId,
    selectedClipTimelineItemIds,
    selectedLibraryAssetId,
    selectedLibraryAssetIds,
    isLibraryAssetMultiSelectMode,
    hasLibraryAssetSelection,
    selectTimelineSelections,
    selectTimelineSelection,
    isTimelineSelectionSelected,
    clearTimelineSelection,
    clearSelectionsForTimelineItem,
    getSelectedClipTimelineItem,
    selectLibraryAssets,
    selectLibraryAsset,
    isLibraryAssetSelected,
    clearLibraryAssetSelection,
    clearAllSelections,
    getSelectionSummary,
    resetToDefaults,
  }
}

export type UnifiedSelectionModule = ReturnType<typeof createUnifiedSelectionModule>
