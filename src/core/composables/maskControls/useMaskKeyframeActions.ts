import type { ComputedRef } from 'vue'
import { useAppI18n } from '@/core/composables/useI18n'
import type { useUnifiedStore } from '@/core/unifiedStore'
import type { MaskPropertyPath, MaskType } from '@/core/timelineitem/mask'
import {
  getKeyframeButtonState,
  getNextKeyframeFrame,
  getPreviousKeyframeFrame,
} from '@/core/utils/unifiedKeyframeUtils'
import type { UnifiedMaskKeyframeControlsOptions, MaskChannelKey } from './types'

type UnifiedStoreInstance = ReturnType<typeof useUnifiedStore>

interface MaskKeyframeActionsOptions extends UnifiedMaskKeyframeControlsOptions {
  unifiedStore: UnifiedStoreInstance
  canOperateMaskNumbers: ComputedRef<boolean>
}

export function useMaskKeyframeActions(options: MaskKeyframeActionsOptions) {
  const { selectedTimelineItem, currentFrame, unifiedStore, canOperateMaskNumbers } = options
  const { t } = useAppI18n()

  function getMaskChannelButtonState(channel: MaskChannelKey) {
    const item = selectedTimelineItem.value
    if (!item) return 'none'
    return getKeyframeButtonState(item, currentFrame.value, channel)
  }

  function hasPreviousMaskKeyframe(channel: MaskChannelKey) {
    const item = selectedTimelineItem.value
    if (!item) return false
    return getPreviousKeyframeFrame(item, currentFrame.value, channel) !== null
  }

  function hasNextMaskKeyframe(channel: MaskChannelKey) {
    const item = selectedTimelineItem.value
    if (!item) return false
    return getNextKeyframeFrame(item, currentFrame.value, channel) !== null
  }

  function getMaskKeyframeTooltip(channel: MaskChannelKey) {
    if (!canOperateMaskNumbers.value) {
      return t('properties.keyframes.outOfClipRange')
    }

    switch (getMaskChannelButtonState(channel)) {
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

  async function setMaskProperty(path: MaskPropertyPath, value: number) {
    const item = selectedTimelineItem.value
    if (!item) return
    await unifiedStore.updatePropertyWithHistory(item.id, currentFrame.value, path, value)
  }

  async function setEnabled(value: boolean) {
    const item = selectedTimelineItem.value
    if (!item) return
    await unifiedStore.updateMaskWithHistory(item.id, currentFrame.value, { type: 'set-enabled', value })
  }

  async function setType(value: MaskType) {
    const item = selectedTimelineItem.value
    if (!item) return
    await unifiedStore.updateMaskWithHistory(item.id, currentFrame.value, { type: 'set-type', value })
  }

  async function setInverted(value: boolean) {
    const item = selectedTimelineItem.value
    if (!item) return
    await unifiedStore.updateMaskWithHistory(item.id, currentFrame.value, { type: 'set-inverted', value })
  }

  async function toggleMaskKeyframe(channel: MaskChannelKey) {
    const item = selectedTimelineItem.value
    if (!item) return
    await unifiedStore.toggleKeyframeWithHistory(item.id, currentFrame.value, channel)
  }

  function goToPreviousMaskKeyframe(channel: MaskChannelKey) {
    const item = selectedTimelineItem.value
    if (!item) return
    const frame = getPreviousKeyframeFrame(item, currentFrame.value, channel)
    if (frame !== null) {
      unifiedStore.seekToFrame(frame)
    }
  }

  function goToNextMaskKeyframe(channel: MaskChannelKey) {
    const item = selectedTimelineItem.value
    if (!item) return
    const frame = getNextKeyframeFrame(item, currentFrame.value, channel)
    if (frame !== null) {
      unifiedStore.seekToFrame(frame)
    }
  }

  return {
    getMaskChannelButtonState,
    hasPreviousMaskKeyframe,
    hasNextMaskKeyframe,
    getMaskKeyframeTooltip,
    setMaskProperty,
    setEnabled,
    setType,
    setInverted,
    toggleMaskKeyframe,
    goToPreviousMaskKeyframe,
    goToNextMaskKeyframe,
  }
}
