import { ref, computed } from 'vue'
import type { UnifiedTimelineItemData } from '@/core/timelineitem/type'
import type { ModuleRegistry } from './ModuleRegistry'
import { MODULE_NAMES } from './ModuleRegistry'
import type { UnifiedTimelineModule } from './UnifiedTimelineModule'
import type { UnifiedDirectoryModule } from './UnifiedDirectoryModule'
import type { UnifiedMediaModule } from './UnifiedMediaModule'
import type { DisplayItem } from '@/core/directory/types'
import { isEffectTemplateAsset } from '@/core/asset/types'
import {
  buildClipSelectionId,
  buildTransitionSelectionId,
  parseTimelineSelectionId,
  type TimelineSelectionId,
} from '@/core/types/timelineSelection'
import type { TimelineTransitionOverlayViewModel } from '@/core/timelineitem/transitionOverlay'

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

  const selectedTimelineSelectionId = computed(() => {
    return selectedTimelineSelectionIds.value.size === 1
      ? Array.from(selectedTimelineSelectionIds.value)[0]
      : null
  })

  const isTimelineSelectionMultiSelectMode = computed(
    () => selectedTimelineSelectionIds.value.size > 1,
  )
  const hasSelection = computed(() => selectedTimelineSelectionIds.value.size > 0)

  const selectedClipTimelineItemIds = computed(() => {
    return Array.from(selectedTimelineSelectionIds.value).flatMap((selectionId) => {
      const parsed = parseTimelineSelectionId(selectionId)
      return parsed?.kind === 'clip' ? [parsed.sourceId] : []
    })
  })

  const selectedClipTimelineItemId = computed(() => {
    const parsed = parseTimelineSelectionId(selectedTimelineSelectionId.value)
    return parsed?.kind === 'clip' ? parsed.sourceId : null
  })

  const selectedTransitionSourceItemIds = computed(() => {
    return Array.from(selectedTimelineSelectionIds.value).flatMap((selectionId) => {
      const parsed = parseTimelineSelectionId(selectionId)
      return parsed?.kind === 'transition' ? [parsed.sourceId] : []
    })
  })

  const selectedTransitionSourceItemId = computed(() => {
    const parsed = parseTimelineSelectionId(selectedTimelineSelectionId.value)
    return parsed?.kind === 'transition' ? parsed.sourceId : null
  })

  const selectedLibraryAssetId = computed(() => {
    return selectedLibraryAssetIds.value.size === 1
      ? Array.from(selectedLibraryAssetIds.value)[0]
      : null
  })

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
      if (targetSet.has(id)) {
        targetSet.delete(id)
      } else {
        targetSet.add(id)
      }
    })
  }

  function selectTimelineItems(itemIds: TimelineSelectionId[], mode: SelectionMode = 'replace') {
    const oldSelection = new Set(selectedTimelineSelectionIds.value)

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

    console.log('🎯 统一选择操作:', {
      itemType: 'timeline-selection',
      mode,
      itemIds,
      oldSize: oldSelection.size,
      newSize: selectedTimelineSelectionIds.value.size,
    })
  }

  function selectLibraryItems(itemIds: string[], mode: SelectionMode = 'replace') {
    const oldSelection = new Set(selectedLibraryAssetIds.value)

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

    console.log('🎯 统一选择操作:', {
      itemType: 'library-asset',
      mode,
      itemIds,
      oldSize: oldSelection.size,
      newSize: selectedLibraryAssetIds.value.size,
    })
  }

  function handleLibraryAssetRangeSelection(endItemId: string) {
    const allItems = getOrderedDisplayItems()

    if (!allItems || allItems.length === 0) return

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

    const [minIndex, maxIndex] = [Math.min(startIndex, endIndex), Math.max(startIndex, endIndex)]
    const rangeItems = allItems.slice(minIndex, maxIndex + 1).map((item) => item.id)

    selectLibraryItems(rangeItems, 'replace')
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
        const nameA = (dirA?.name || '').toLowerCase()
        const nameB = (dirB?.name || '').toLowerCase()
        comparison = nameA.localeCompare(nameB, 'zh-CN')
      } else if (a.type === 'asset' && b.type === 'asset') {
        const mediaA = mediaModule.getAsset(a.id)
        const mediaB = mediaModule.getAsset(b.id)

        if (!mediaA || !mediaB) return 0

        switch (sortBy) {
          case 'name':
            comparison = mediaA.name.localeCompare(mediaB.name, 'zh-CN')
            break
          case 'date':
            comparison = (mediaA.createdAt || '').localeCompare(mediaB.createdAt || '')
            break
          case 'type':
            comparison = (
              isEffectTemplateAsset(mediaA)
                ? `effect-${mediaA.effectType}`
                : `media-${mediaA.mediaType}`
            ).localeCompare(
              isEffectTemplateAsset(mediaB)
                ? `effect-${mediaB.effectType}`
                : `media-${mediaB.mediaType}`,
            )
            if (comparison === 0) {
              comparison = mediaA.name.localeCompare(mediaB.name, 'zh-CN')
            }
            break
        }
      }

      return sortOrder === 'asc' ? comparison : -comparison
    })

    return sorted
  }

  function getOrderedDisplayItems(): DisplayItem[] {
    const currentDir = directoryModule.currentDir.value
    if (!currentDir) return []

    const content = directoryModule.getDirectoryContent(currentDir.id)
    return sortDisplayItems(content, directoryModule.sortBy.value, directoryModule.sortOrder.value)
  }

  function selectTimelineSelections(
    itemIds: TimelineSelectionId[],
    mode: 'replace' | 'toggle' = 'replace',
  ) {
    return selectTimelineItems(itemIds, mode)
  }

  function selectTimelineSelection(selectionId: TimelineSelectionId | null) {
    if (selectionId) {
      selectTimelineSelections([selectionId], 'replace')
    } else {
      selectTimelineSelections([], 'replace')
    }
  }

  function selectLibraryAssets(itemIds: string[], mode: SelectionMode = 'replace') {
    return selectLibraryItems(itemIds, mode)
  }

  function selectLibraryAsset(libraryAssetId: string | null) {
    if (libraryAssetId) {
      selectLibraryAssets([libraryAssetId], 'replace')
    } else {
      selectLibraryAssets([], 'replace')
    }
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
    console.log('🔄 时间轴选择已清除')
  }

  function clearLibraryAssetSelection() {
    selectedLibraryAssetIds.value.clear()
    lastSelectedLibraryAssetId.value = null
    console.log('🔄 库素材选择已清除')
  }

  function clearAllSelections() {
    clearTimelineSelection()
    clearLibraryAssetSelection()
  }

  function clearSelectionsForTimelineItem(timelineItemId: string) {
    selectedTimelineSelectionIds.value.delete(buildClipSelectionId(timelineItemId))
    selectedTimelineSelectionIds.value.delete(buildTransitionSelectionId(timelineItemId))

    if (selectedTimelineSelectionIds.value.size === 0) {
      lastSelectedTimelineSelectionId.value = null
    }
  }

  function getSelectedClipTimelineItem(): UnifiedTimelineItemData | null {
    if (!selectedClipTimelineItemId.value) return null
    return getTimelineItem(selectedClipTimelineItemId.value) || null
  }

  function getSelectedTransitionOverlay(): TimelineTransitionOverlayViewModel | null {
    if (!selectedTransitionSourceItemId.value) return null
    return timelineModule.getTransitionOverlay(selectedTransitionSourceItemId.value)
  }

  function getSelectionSummary() {
    const selectedClip = getSelectedClipTimelineItem()
    const selectedTransition = getSelectedTransitionOverlay()

    return {
      hasTimelineSelection: hasSelection.value,
      selectedTimelineSelectionId: selectedTimelineSelectionId.value,
      selectedClipTimelineItemId: selectedClipTimelineItemId.value,
      selectedTransitionSourceItemId: selectedTransitionSourceItemId.value,
      selectedClipTimelineItem: selectedClip
        ? {
            id: selectedClip.id,
            mediaItemId: selectedClip.mediaItemId,
            trackId: selectedClip.trackId,
            startTime: selectedClip.timeRange.timelineStartTime / 1000000,
            endTime: selectedClip.timeRange.timelineEndTime / 1000000,
          }
        : null,
      selectedTransitionOverlay: selectedTransition
        ? {
            sourceItemId: selectedTransition.sourceItemId,
            trackId: selectedTransition.trackId,
          }
        : null,
    }
  }

  function resetToDefaults() {
    clearAllSelections()
    console.log('🔄 选择状态已重置为默认值')
  }

  return {
    selectedTimelineSelectionId,
    selectedTimelineSelectionIds,
    isTimelineSelectionMultiSelectMode,
    hasSelection,
    selectedClipTimelineItemId,
    selectedClipTimelineItemIds,
    selectedTransitionSourceItemId,
    selectedTransitionSourceItemIds,
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
    getSelectedTransitionOverlay,
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
