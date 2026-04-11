import type { ComputedRef } from 'vue'
import { useAppI18n } from '@/core/composables/useI18n'
import type { useUnifiedStore } from '@/core/unifiedStore'
import {
  getKeyframeButtonState,
  getNextKeyframeFrame,
  getPreviousKeyframeFrame,
} from '@/core/utils/unifiedKeyframeUtils'
import type {
  FilterChannelKey,
  UnifiedFilterControlsOptions,
} from './types'

type UnifiedStoreInstance = ReturnType<typeof useUnifiedStore>

interface FilterKeyframeActionsOptions extends UnifiedFilterControlsOptions {
  unifiedStore: UnifiedStoreInstance
  canOperateFilterNumbers: ComputedRef<boolean>
}

const FILTER_CHANNEL: FilterChannelKey = 'filter.intensity'

export function useFilterKeyframeActions(options: FilterKeyframeActionsOptions) {
  const { selectedTimelineItem, currentFrame, unifiedStore, canOperateFilterNumbers } = options
  const { t } = useAppI18n()

  function getFilterChannelButtonState(channel: FilterChannelKey = FILTER_CHANNEL) {
    const item = selectedTimelineItem.value
    if (!item) return 'none'
    return getKeyframeButtonState(item, currentFrame.value, channel)
  }

  function hasPreviousFilterKeyframe(channel: FilterChannelKey = FILTER_CHANNEL) {
    const item = selectedTimelineItem.value
    if (!item) return false
    return getPreviousKeyframeFrame(item, currentFrame.value, channel) !== null
  }

  function hasNextFilterKeyframe(channel: FilterChannelKey = FILTER_CHANNEL) {
    const item = selectedTimelineItem.value
    if (!item) return false
    return getNextKeyframeFrame(item, currentFrame.value, channel) !== null
  }

  function getFilterKeyframeTooltip(channel: FilterChannelKey = FILTER_CHANNEL) {
    if (!canOperateFilterNumbers.value) {
      return t('properties.keyframes.outOfClipRange')
    }

    switch (getFilterChannelButtonState(channel)) {
      case 'none':
        return t('properties.keyframes.createAnimation')
      case 'on-keyframe':
        return t('properties.keyframes.deleteCurrent')
      case 'between-keyframes':
        return t('properties.keyframes.createAtCurrent')
      default:
        return t('properties.keyframes.control')
    }
  }

  async function toggleFilterKeyframe(channel: FilterChannelKey = FILTER_CHANNEL) {
    const item = selectedTimelineItem.value
    if (!item) return
    await unifiedStore.toggleKeyframeWithHistory(item.id, currentFrame.value, channel)
  }

  function goToPreviousFilterKeyframe(channel: FilterChannelKey = FILTER_CHANNEL) {
    const item = selectedTimelineItem.value
    if (!item) return
    const frame = getPreviousKeyframeFrame(item, currentFrame.value, channel)
    if (frame !== null) {
      unifiedStore.seekToFrame(frame)
    }
  }

  function goToNextFilterKeyframe(channel: FilterChannelKey = FILTER_CHANNEL) {
    const item = selectedTimelineItem.value
    if (!item) return
    const frame = getNextKeyframeFrame(item, currentFrame.value, channel)
    if (frame !== null) {
      unifiedStore.seekToFrame(frame)
    }
  }

  return {
    getFilterChannelButtonState,
    hasPreviousFilterKeyframe,
    hasNextFilterKeyframe,
    getFilterKeyframeTooltip,
    toggleFilterKeyframe,
    goToPreviousFilterKeyframe,
    goToNextFilterKeyframe,
  }
}
