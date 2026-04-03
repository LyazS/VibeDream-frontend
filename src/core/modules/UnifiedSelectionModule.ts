import { ref, computed } from 'vue'
import type { UnifiedTimelineItemData } from '@/core/timelineitem/type'
import type { UnifiedMediaItemData } from '@/core/mediaitem/types'
import type { ModuleRegistry } from './ModuleRegistry'
import { MODULE_NAMES } from './ModuleRegistry'
import type { UnifiedTimelineModule } from './UnifiedTimelineModule'
import type { UnifiedDirectoryModule } from './UnifiedDirectoryModule'
import type { UnifiedMediaModule } from './UnifiedMediaModule'
import type { DisplayItem } from '@/core/directory/types'
import {
  buildClipSelectionId,
  buildTransitionSelectionId,
  parseTimelineSelectionId,
  type TimelineSelectionId,
} from '@/core/types/timelineSelection'
import type { TimelineTransitionOverlayViewModel } from '@/core/timelineitem/transitionOverlay'

export type SelectionItemType = 'timeline-selection' | 'media-item'
export type SelectionMode = 'replace' | 'toggle' | 'range'

export function createUnifiedSelectionModule(registry: ModuleRegistry) {
  const timelineModule = registry.get<UnifiedTimelineModule>(MODULE_NAMES.TIMELINE)
  const directoryModule = registry.get<UnifiedDirectoryModule>(MODULE_NAMES.DIRECTORY)
  const mediaModule = registry.get<UnifiedMediaModule>(MODULE_NAMES.MEDIA)
  const getTimelineItem = (id: string) => timelineModule.getTimelineItem(id)

  const selectedTimelineSelectionIds = ref<Set<TimelineSelectionId>>(new Set())
  const lastSelectedTimelineSelectionId = ref<TimelineSelectionId | null>(null)

  const selectedMediaItemIds = ref<Set<string>>(new Set())
  const lastSelectedMediaItemId = ref<string | null>(null)

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

  const selectedMediaItemId = computed(() => {
    return selectedMediaItemIds.value.size === 1
      ? Array.from(selectedMediaItemIds.value)[0]
      : null
  })

  const isMediaMultiSelectMode = computed(() => selectedMediaItemIds.value.size > 1)
  const hasMediaSelection = computed(() => selectedMediaItemIds.value.size > 0)

  function selectItems(
    itemIds: string[],
    mode: SelectionMode = 'replace',
    itemType: SelectionItemType,
  ) {
    const targetSet =
      itemType === 'timeline-selection'
        ? (selectedTimelineSelectionIds.value as unknown as Set<string>)
        : selectedMediaItemIds.value

    const oldSelection = new Set(targetSet)

    if (itemType === 'timeline-selection' && selectedMediaItemIds.value.size > 0) {
      selectedMediaItemIds.value.clear()
      lastSelectedMediaItemId.value = null
    } else if (itemType === 'media-item' && selectedTimelineSelectionIds.value.size > 0) {
      selectedTimelineSelectionIds.value.clear()
      lastSelectedTimelineSelectionId.value = null
    }

    if (mode === 'range') {
      if (itemType === 'media-item') {
        handleMediaRangeSelection(itemIds[0])
      } else {
        console.warn('⚠️ 时间轴选择不支持范围选择模式')
      }
      return
    }

    if (mode === 'replace') {
      targetSet.clear()
      itemIds.forEach((id) => targetSet.add(id))
    } else {
      itemIds.forEach((id) => {
        if (targetSet.has(id)) {
          targetSet.delete(id)
        } else {
          targetSet.add(id)
        }
      })
    }

    if (targetSet.size === 0) {
      if (itemType === 'timeline-selection') {
        lastSelectedTimelineSelectionId.value = null
      } else {
        lastSelectedMediaItemId.value = null
      }
    } else if (itemIds.length > 0) {
      if (itemType === 'timeline-selection') {
        lastSelectedTimelineSelectionId.value = itemIds[itemIds.length - 1] as TimelineSelectionId
      } else {
        lastSelectedMediaItemId.value = itemIds[itemIds.length - 1]
      }
    }

    console.log('🎯 统一选择操作:', {
      itemType,
      mode,
      itemIds,
      oldSize: oldSelection.size,
      newSize: targetSet.size,
    })
  }

  function handleMediaRangeSelection(endItemId: string) {
    const allItems = getOrderedDisplayItems()

    if (!allItems || allItems.length === 0) return

    const startItemId = lastSelectedMediaItemId.value

    if (!startItemId) {
      selectItems([endItemId], 'replace', 'media-item')
      return
    }

    const startIndex = allItems.findIndex((item) => item.id === startItemId)
    const endIndex = allItems.findIndex((item) => item.id === endItemId)

    if (startIndex === -1 || endIndex === -1) {
      selectItems([endItemId], 'replace', 'media-item')
      return
    }

    const [minIndex, maxIndex] = [Math.min(startIndex, endIndex), Math.max(startIndex, endIndex)]
    const rangeItems = allItems.slice(minIndex, maxIndex + 1).map((item) => item.id)

    selectItems(rangeItems, 'replace', 'media-item')
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
      } else if (a.type === 'media' && b.type === 'media') {
        const mediaA = mediaModule.getMediaItem(a.id)
        const mediaB = mediaModule.getMediaItem(b.id)

        if (!mediaA || !mediaB) return 0

        switch (sortBy) {
          case 'name':
            comparison = mediaA.name.localeCompare(mediaB.name, 'zh-CN')
            break
          case 'date':
            comparison = (mediaA.createdAt || '').localeCompare(mediaB.createdAt || '')
            break
          case 'type':
            comparison = mediaA.mediaType.localeCompare(mediaB.mediaType)
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
    return selectItems(itemIds, mode, 'timeline-selection')
  }

  function selectTimelineSelection(selectionId: TimelineSelectionId | null) {
    if (selectionId) {
      selectTimelineSelections([selectionId], 'replace')
    } else {
      selectTimelineSelections([], 'replace')
    }
  }

  function selectMediaItems(itemIds: string[], mode: SelectionMode = 'replace') {
    return selectItems(itemIds, mode, 'media-item')
  }

  function selectMediaItem(mediaItemId: string | null) {
    if (mediaItemId) {
      selectMediaItems([mediaItemId], 'replace')
    } else {
      selectMediaItems([], 'replace')
    }
  }

  function isMediaItemSelected(mediaItemId: string): boolean {
    return selectedMediaItemIds.value.has(mediaItemId)
  }

  function isTimelineSelectionSelected(selectionId: TimelineSelectionId): boolean {
    return selectedTimelineSelectionIds.value.has(selectionId)
  }

  function clearTimelineSelection() {
    selectedTimelineSelectionIds.value.clear()
    lastSelectedTimelineSelectionId.value = null
    console.log('🔄 时间轴选择已清除')
  }

  function clearMediaSelection() {
    selectedMediaItemIds.value.clear()
    lastSelectedMediaItemId.value = null
    console.log('🔄 媒体项目选择已清除')
  }

  function clearAllSelections() {
    clearTimelineSelection()
    clearMediaSelection()
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
            preset: selectedTransition.preset,
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
    selectedMediaItemId,
    selectedMediaItemIds,
    isMediaMultiSelectMode,
    hasMediaSelection,
    selectTimelineSelections,
    selectTimelineSelection,
    isTimelineSelectionSelected,
    clearTimelineSelection,
    clearSelectionsForTimelineItem,
    getSelectedClipTimelineItem,
    getSelectedTransitionOverlay,
    selectMediaItems,
    selectMediaItem,
    isMediaItemSelected,
    clearMediaSelection,
    clearAllSelections,
    getSelectionSummary,
    resetToDefaults,
  }
}

export type UnifiedSelectionModule = ReturnType<typeof createUnifiedSelectionModule>
