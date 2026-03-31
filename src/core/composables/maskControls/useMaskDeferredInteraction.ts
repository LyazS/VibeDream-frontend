import { ref, type ComputedRef } from 'vue'
import type { useUnifiedStore } from '@/core/unifiedStore'
import {
  getAnimationChannelForProperty,
  type AnimationChannelKey,
} from '@/core/timelineitem/bunnytype'
import {
  MASK_ANIMATABLE_PATHS,
  setMaskPropertyValue,
  type MaskPropertyPath,
} from '@/core/timelineitem/mask'
import { TimelineItemQueries } from '@/core/timelineitem/queries'
import type { UnifiedTimelineItemData } from '@/core/timelineitem/type'
import { BatchUpdateMaskCommand } from '@/core/modules/commands/batchCommands'
import { UpdateMaskCommand } from '@/core/modules/commands/keyframes'
import {
  createChannelKeyframe,
  findKeyframeAtFrame,
  getKeyframeButtonState,
  sortKeyframes,
} from '@/core/utils/unifiedKeyframeUtils'
import type {
  MaskChannelDragState,
  MaskDeferredPatch,
  MaskDragKeyframe,
  MaskInteractionState,
  UnifiedMaskKeyframeControlsOptions,
} from './types'

type UnifiedStoreInstance = ReturnType<typeof useUnifiedStore>

interface MaskDeferredInteractionOptions extends UnifiedMaskKeyframeControlsOptions {
  unifiedStore: UnifiedStoreInstance
  canOperateMaskNumbers: ComputedRef<boolean>
  itemLocalSize: ComputedRef<{ width: number; height: number }>
  maskConfig: ComputedRef<{
    centerX: number
    centerY: number
    rotation: number
    falloff: { outerRange: number; decayRate: number }
  }>
  rectangleMaskConfig: ComputedRef<{ width: number; height: number; cornerRadius: number } | null>
  ellipseMaskConfig: ComputedRef<{ ellipseWidth: number; ellipseHeight: number } | null>
  mirrorMaskConfig: ComputedRef<{ length: number } | null>
}

export function useMaskDeferredInteraction(options: MaskDeferredInteractionOptions) {
  const {
    selectedTimelineItem,
    currentFrame,
    unifiedStore,
    canOperateMaskNumbers,
    itemLocalSize,
    maskConfig,
    rectangleMaskConfig,
    ellipseMaskConfig,
    mirrorMaskConfig,
  } = options

  const interactionState = ref<MaskInteractionState>({
    isActive: false,
    channels: {},
    pendingPatch: {},
  })

  function resetInteractionState() {
    interactionState.value = {
      isActive: false,
      channels: {},
      pendingPatch: {},
    }
  }

  function ensureMaskChannel(item: UnifiedTimelineItemData, channel: AnimationChannelKey) {
    const animation = (item.animation ??= { channels: {} } as UnifiedTimelineItemData['animation'])!
    const channels = animation.channels as Partial<
      Record<AnimationChannelKey, { keyframes: MaskDragKeyframe[] }>
    >

    if (!channels[channel]) {
      channels[channel] = { keyframes: [] }
    }

    return channels[channel]!.keyframes
  }

  function setMaskConfigDuringDrag(
    item: UnifiedTimelineItemData,
    path: MaskPropertyPath,
    value: number,
  ) {
    if (!TimelineItemQueries.hasVisualProperties(item)) return
    item.config.mask = setMaskPropertyValue(item.config.mask, path, value, itemLocalSize.value)
  }

  function setMaskKeyframeProperty(
    keyframe: MaskDragKeyframe,
    path: MaskPropertyPath,
    value: number,
  ) {
    ;(keyframe.properties as Record<MaskPropertyPath, number>)[path] = value
  }

  function getCurrentMaskValue(path: MaskPropertyPath) {
    switch (path) {
      case 'mask.centerX':
        return maskConfig.value.centerX
      case 'mask.centerY':
        return maskConfig.value.centerY
      case 'mask.rotation':
        return maskConfig.value.rotation
      case 'mask.width':
        return rectangleMaskConfig.value?.width ?? 0
      case 'mask.height':
        return rectangleMaskConfig.value?.height ?? 0
      case 'mask.cornerRadius':
        return rectangleMaskConfig.value?.cornerRadius ?? 0
      case 'mask.ellipseWidth':
        return ellipseMaskConfig.value?.ellipseWidth ?? 0
      case 'mask.ellipseHeight':
        return ellipseMaskConfig.value?.ellipseHeight ?? 0
      case 'mask.length':
        return mirrorMaskConfig.value?.length ?? 0
      case 'mask.outerRange':
        return maskConfig.value.falloff.outerRange
      case 'mask.decayRate':
        return maskConfig.value.falloff.decayRate
    }
  }

  function beginMaskInteraction() {
    if (!selectedTimelineItem.value || !canOperateMaskNumbers.value) return
    interactionState.value.isActive = true
  }

  function ensureChannelInteraction(channel: AnimationChannelKey) {
    const item = selectedTimelineItem.value
    if (!item || interactionState.value.channels[channel]) return

    interactionState.value.channels[channel] = {
      channel,
      initialValues: {},
      createdKeyframe: null,
      initialButtonState: getKeyframeButtonState(item, currentFrame.value, channel),
    }

    const channelState = interactionState.value.channels[channel]!
    if (channelState.initialButtonState === 'between-keyframes') {
      const keyframes = ensureMaskChannel(item, channel)
      const keyframe = createChannelKeyframe(item, currentFrame.value, channel) as MaskDragKeyframe
      keyframes.push(keyframe)
      sortKeyframes(item, channel)
      channelState.createdKeyframe = keyframe
    }
  }

  function updateMaskPropertyDuringDrag(path: MaskPropertyPath, value: number) {
    const item = selectedTimelineItem.value
    const channel = getAnimationChannelForProperty(path)
    if (!item || !channel) return

    const channelState = interactionState.value.channels[channel]
    const buttonState = channelState?.initialButtonState
    if (!buttonState) return

    if (buttonState === 'none') {
      setMaskConfigDuringDrag(item, path, value)
      return
    }

    if (buttonState === 'on-keyframe') {
      const keyframe = findKeyframeAtFrame(item, currentFrame.value, channel)
      if (keyframe) {
        setMaskKeyframeProperty(keyframe as MaskDragKeyframe, path, value)
      }
      return
    }

    if (buttonState === 'between-keyframes' && channelState.createdKeyframe) {
      setMaskKeyframeProperty(channelState.createdKeyframe, path, value)
    }
  }

  function applyMaskDeferredPatch(patch: MaskDeferredPatch) {
    const item = selectedTimelineItem.value
    if (!item || !canOperateMaskNumbers.value) return

    beginMaskInteraction()

    for (const [path, value] of Object.entries(patch) as [MaskPropertyPath, number][]) {
      if (!Number.isFinite(value)) continue
      const channel = getAnimationChannelForProperty(path)
      if (!channel) continue

      ensureChannelInteraction(channel)
      const channelState = interactionState.value.channels[channel]!
      if (channelState.initialValues[path] === undefined) {
        channelState.initialValues[path] = getCurrentMaskValue(path)
      }

      updateMaskPropertyDuringDrag(path, value)
      interactionState.value.pendingPatch[path] = value
    }
  }

  function beginMaskDrag(path: MaskPropertyPath, value: number) {
    applyMaskDeferredPatch({ [path]: value })
  }

  async function commitMaskBatch(updates: Partial<Record<MaskPropertyPath, number>>) {
    const item = selectedTimelineItem.value
    if (!item) return

    const updateCommands = MASK_ANIMATABLE_PATHS
      .filter((path) => updates[path] !== undefined)
      .map((path) => new UpdateMaskCommand(
        item.id,
        currentFrame.value,
        {
          type: 'set-property',
          path,
          value: updates[path]!,
        },
        {
          getTimelineItem: (id: string) => unifiedStore.getTimelineItem(id),
        },
        {
          getMediaItem: (id: string | null) => (id ? unifiedStore.getMediaItem(id) : undefined),
        },
        {
          seekTo: unifiedStore.seekToFrame,
        },
      ))

    if (updateCommands.length === 0) return

    const batchCommand = new BatchUpdateMaskCommand([item.id], updateCommands)
    await unifiedStore.executeBatchCommand(batchCommand)
  }

  function setMaskCenterDeferred(centerX: number, centerY: number) {
    applyMaskDeferredPatch({
      'mask.centerX': centerX,
      'mask.centerY': centerY,
    })
  }

  function setRectangleMaskSizeDeferred(width: number, height: number) {
    applyMaskDeferredPatch({
      'mask.width': width,
      'mask.height': height,
    })
  }

  function setMaskRotationDeferred(value: number) {
    beginMaskDrag('mask.rotation', value)
  }

  function setMaskOuterRangeDeferred(value: number) {
    beginMaskDrag('mask.outerRange', value)
  }

  function setMaskDecayRateDeferred(value: number) {
    beginMaskDrag('mask.decayRate', value)
  }

  function setMaskCornerRadiusDeferred(value: number) {
    beginMaskDrag('mask.cornerRadius', value)
  }

  function setMaskLengthDeferred(value: number) {
    beginMaskDrag('mask.length', value)
  }

  function restoreChannelState(item: UnifiedTimelineItemData, channelState: MaskChannelDragState) {
    const { channel, initialButtonState, initialValues, createdKeyframe } = channelState

    if (initialButtonState === 'none') {
      for (const [path, value] of Object.entries(initialValues) as [MaskPropertyPath, number][]) {
        setMaskConfigDuringDrag(item, path, value)
      }
      return
    }

    if (initialButtonState === 'on-keyframe') {
      const keyframe = findKeyframeAtFrame(item, currentFrame.value, channel)
      if (!keyframe) return

      for (const [path, value] of Object.entries(initialValues) as [MaskPropertyPath, number][]) {
        setMaskKeyframeProperty(keyframe as MaskDragKeyframe, path, value)
      }
      return
    }

    if (initialButtonState === 'between-keyframes' && createdKeyframe) {
      const channels = item.animation?.channels as
        | Partial<Record<AnimationChannelKey, { keyframes: MaskDragKeyframe[] }>>
        | undefined
      const keyframes = channels?.[channel]?.keyframes
      const index = keyframes?.indexOf(createdKeyframe) ?? -1
      if (keyframes && index !== -1) {
        keyframes.splice(index, 1)
      }
    }
  }

  async function commitMaskInteraction() {
    const item = selectedTimelineItem.value
    const pendingPatch = { ...interactionState.value.pendingPatch }
    const pendingPatchEntries = Object.entries(pendingPatch) as [MaskPropertyPath, number][]

    if (!item || !interactionState.value.isActive || pendingPatchEntries.length === 0) {
      return
    }

    for (const channelState of Object.values(interactionState.value.channels)) {
      if (channelState) {
        restoreChannelState(item, channelState)
      }
    }

    resetInteractionState()

    await commitMaskBatch(pendingPatch)
  }

  async function cancelMaskInteraction() {
    const item = selectedTimelineItem.value
    if (item) {
      for (const channelState of Object.values(interactionState.value.channels)) {
        if (channelState) {
          restoreChannelState(item, channelState)
        }
      }
    }

    resetInteractionState()
  }

  async function commitDeferredUpdates() {
    await commitMaskInteraction()
  }

  return {
    beginMaskInteraction,
    applyMaskDeferredPatch,
    commitMaskInteraction,
    cancelMaskInteraction,
    setMaskCenterDeferred,
    setRectangleMaskSizeDeferred,
    setMaskRotationDeferred,
    setMaskOuterRangeDeferred,
    setMaskDecayRateDeferred,
    setMaskCornerRadiusDeferred,
    setMaskLengthDeferred,
    commitDeferredUpdates,
  }
}
