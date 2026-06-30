import { computed, type Ref } from 'vue'
import { useUnifiedStore } from '@/core/unifiedStore'
import type { UnifiedTimelineItemData } from '@/core/timelineitem/model/timelineItem'
import { TimelineItemQueries } from '@/core/timelineitem/queries'
import type { AnimationChannelKey } from '@/core/timelineitem/model/render'
import {
  getKeyframeButtonState,
  getKeyframeUIState,
  getPreviousKeyframeFrame,
  getNextKeyframeFrame,
} from '@/core/utils/unifiedKeyframeUtils'
import { isPlayheadInTimelineItem } from '@/core/utils/timelineSearchUtils'
import { normalizeAngle } from '@/core/utils/rotationTransform'
import type { BlendMode } from '@/core/timelineitem/model/blendMode'
import { isBlendMode } from '@/core/timelineitem/model/blendMode'
import { propertyMutationCommitter, type ChangeOperation } from '@/core/property-system'
import {
  clearAudioVolumeOverlay,
  clearVisualBlendIntensityOverlay,
  clearVisualPositionOverlay,
  clearVisualRotationOverlay,
  clearVisualSizeOverlay,
  getAudioVolumeOverlay,
  getVisualBlendIntensityOverlay,
  getVisualPositionOverlay,
  getVisualSizeOverlay,
  setAudioVolumeOverlay,
  setVisualBlendIntensityOverlay,
  setVisualPositionOverlay,
  setVisualRotationOverlay,
  setVisualSizeOverlay,
} from '@/core/property-system/render-state'

interface UnifiedKeyframeVisualControlsOptions {
  selectedTimelineItem: Ref<UnifiedTimelineItemData | null>
  currentFrame: Ref<number>
}

type VisualKeyframeChannel =
  | 'audio.volume'
  | 'visual.blendIntensity'
  | 'visual.size'
  | 'visual.position'
  | 'visual.rotation'

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

export function useUnifiedKeyframeVisualControls(
  options: UnifiedKeyframeVisualControlsOptions,
) {
  const { selectedTimelineItem, currentFrame } = options
  const unifiedStore = useUnifiedStore()

  function getCommitContext(item: UnifiedTimelineItemData) {
    return {
      item,
      frame: currentFrame.value,
      applyChangePlan: unifiedStore.applyChangePlanWithHistory,
    }
  }

  const canOperateVisualChannels = computed(() => {
    if (!selectedTimelineItem.value) return false
    return isPlayheadInTimelineItem(selectedTimelineItem.value, currentFrame.value)
  })

  const visualRenderConfig = computed(() => {
    const item = selectedTimelineItem.value
    if (!item || !TimelineItemQueries.hasVisualProperties(item)) {
      return null
    }
    return TimelineItemQueries.getResolvedRenderConfig(item).visual
  })
  const audioRenderConfig = computed(() => {
    const item = selectedTimelineItem.value
    if (!item || !TimelineItemQueries.hasAudioProperties(item)) {
      return null
    }
    return TimelineItemQueries.getResolvedRenderConfig(item).audio
  })

  function getOriginalDimensions() {
    const item = selectedTimelineItem.value
    if (!item || !TimelineItemQueries.hasVisualProperties(item)) {
      return { width: 0, height: 0 }
    }

    if (TimelineItemQueries.isTextTimelineItem(item)) {
      const currentRenderConfig = visualRenderConfig.value
      return {
        width: item.runtime.textBitmap?.width ?? currentRenderConfig?.width ?? 0,
        height: item.runtime.textBitmap?.height ?? currentRenderConfig?.height ?? 0,
      }
    }

    const mediaItem = unifiedStore.getMediaItem(item.mediaItemId)
    const currentRenderConfig = visualRenderConfig.value
    return {
      width: mediaItem?.runtime.bunny?.originalWidth ?? currentRenderConfig?.width ?? 0,
      height: mediaItem?.runtime.bunny?.originalHeight ?? currentRenderConfig?.height ?? 0,
    }
  }

  const visualX = computed(() => visualRenderConfig.value?.x ?? 0)
  const visualY = computed(() => visualRenderConfig.value?.y ?? 0)
  const displayWidth = computed(() => visualRenderConfig.value?.width ?? 0)
  const displayHeight = computed(() => visualRenderConfig.value?.height ?? 0)
  const rotation = computed(() => visualRenderConfig.value?.rotation ?? 0)
  const blendIntensity = computed(() => visualRenderConfig.value?.blendIntensity ?? 1)
  const blendMode = computed(() => visualRenderConfig.value?.blendMode ?? 'normal')
  const volume = computed(() => audioRenderConfig.value?.volume ?? 1)
  const elementWidth = computed(() => getOriginalDimensions().width)
  const elementHeight = computed(() => getOriginalDimensions().height)
  const proportionalScale = computed(() =>
    Boolean(
      selectedTimelineItem.value &&
      TimelineItemQueries.hasVisualProperties(selectedTimelineItem.value) &&
      visualRenderConfig.value?.proportionalScale,
    ),
  )
  function getScaledSizeFromWidth(nextWidth: number): Record<string, number> {
    const { width: originalWidth, height: originalHeight } = getOriginalDimensions()
    if (originalWidth <= 0 || originalHeight <= 0) {
      return { width: nextWidth }
    }

    return {
      width: nextWidth,
      height: Math.round((nextWidth * originalHeight) / originalWidth),
    }
  }

  function getScaledSizeFromHeight(nextHeight: number): Record<string, number> {
    const { width: originalWidth, height: originalHeight } = getOriginalDimensions()
    if (originalWidth <= 0 || originalHeight <= 0) {
      return { height: nextHeight }
    }

    return {
      width: Math.round((nextHeight * originalWidth) / originalHeight),
      height: nextHeight,
    }
  }

  const getChannelButtonState = (groupId: AnimationChannelKey) => {
    const item = selectedTimelineItem.value
    if (!item) return 'none'
    return getKeyframeButtonState(item, currentFrame.value, groupId)
  }

  const getChannelKeyframeUIState = (groupId: AnimationChannelKey) => {
    const item = selectedTimelineItem.value
    if (!item) return { hasAnimation: false, isOnKeyframe: false }
    return getKeyframeUIState(item, currentFrame.value, groupId)
  }

  const hasPreviousChannelKeyframe = (groupId: AnimationChannelKey) => {
    const item = selectedTimelineItem.value
    if (!item) return false
    return getPreviousKeyframeFrame(item, currentFrame.value, groupId) !== null
  }

  const hasNextChannelKeyframe = (groupId: AnimationChannelKey) => {
    const item = selectedTimelineItem.value
    if (!item) return false
    return getNextKeyframeFrame(item, currentFrame.value, groupId) !== null
  }

  const goToPreviousChannelKeyframe = (groupId: AnimationChannelKey) => {
    const item = selectedTimelineItem.value
    if (!item) return
    const frame = getPreviousKeyframeFrame(item, currentFrame.value, groupId)
    if (frame !== null) unifiedStore.seekToFrame(frame)
  }

  const goToNextChannelKeyframe = (groupId: AnimationChannelKey) => {
    const item = selectedTimelineItem.value
    if (!item) return
    const frame = getNextKeyframeFrame(item, currentFrame.value, groupId)
    if (frame !== null) unifiedStore.seekToFrame(frame)
  }

  const toggleChannelKeyframe = async (groupId: VisualKeyframeChannel) => {
    switch (groupId) {
      case 'audio.volume': {
        const item = selectedTimelineItem.value
        if (!item || !canOperateVisualChannels.value) return
        await propertyMutationCommitter.toggleKeyframe(getCommitContext(item), 'audio.volume')
        return
      }
      case 'visual.blendIntensity': {
        const item = selectedTimelineItem.value
        if (!item || !canOperateVisualChannels.value) return
        await propertyMutationCommitter.toggleKeyframe(getCommitContext(item), 'visual.blendIntensity')
        return
      }
      case 'visual.size': {
        const item = selectedTimelineItem.value
        if (!item || !canOperateVisualChannels.value) return
        await propertyMutationCommitter.toggleKeyframe(getCommitContext(item), 'visual.size')
        return
      }
      case 'visual.position': {
        const item = selectedTimelineItem.value
        if (!item || !canOperateVisualChannels.value) return
        await propertyMutationCommitter.toggleKeyframe(getCommitContext(item), 'visual.position')
        return
      }
      case 'visual.rotation': {
        const item = selectedTimelineItem.value
        if (!item || !canOperateVisualChannels.value) return
        clearVisualRotationOverlay(item.id)
        await propertyMutationCommitter.toggleKeyframe(getCommitContext(item), 'visual.rotation')
        return
      }
      default: {
        const unreachableGroupId: never = groupId
        return unreachableGroupId
      }
    }
  }

  const getChannelKeyframeTooltip = (groupId: AnimationChannelKey) => {
    if (!canOperateVisualChannels.value) {
      return '播放头不在当前clip时间范围内，无法操作关键帧'
    }
    switch (getChannelButtonState(groupId)) {
      case 'none':
        return '点击创建关键帧动画'
      case 'on-keyframe':
        return '当前在关键帧位置，点击删除关键帧'
      case 'between-keyframes':
        return '点击在当前位置创建关键帧'
      default:
        return '关键帧控制'
    }
  }

  async function commitRotationDeferredUpdate(nextValue?: number) {
    const item = selectedTimelineItem.value
    if (!item || !canOperateVisualChannels.value) return
    const nextRotation = typeof nextValue === 'number' ? normalizeAngle(nextValue) : rotation.value
    await propertyMutationCommitter.commitDirect(getCommitContext(item), 'visual.rotation', nextRotation)
    clearVisualRotationOverlay(item.id)
  }

  async function commitPositionDeferredUpdate(axis: 'x' | 'y', nextValue?: number) {
    const item = selectedTimelineItem.value
    if (!item || !canOperateVisualChannels.value) return

    const positionOverlay = getVisualPositionOverlay(item.id)
    const currentRenderConfig = visualRenderConfig.value
    const resolvedValue =
      typeof nextValue === 'number'
        ? nextValue
        : positionOverlay?.[axis] ?? currentRenderConfig?.[axis]

    if (!isFiniteNumber(resolvedValue)) {
      return
    }

    await propertyMutationCommitter.commitDirect(getCommitContext(item), 'visual.position', { [axis]: resolvedValue })
    clearVisualPositionOverlay(item.id)
  }

  async function commitVisualPositionDeferredUpdate() {
    const item = selectedTimelineItem.value
    if (!item || !canOperateVisualChannels.value) return

    const positionOverlay = getVisualPositionOverlay(item.id)
    if (!positionOverlay) return

    const currentRenderConfig = visualRenderConfig.value
    const x = positionOverlay.x ?? currentRenderConfig?.x
    const y = positionOverlay.y ?? currentRenderConfig?.y
    if (!isFiniteNumber(x) || !isFiniteNumber(y)) return

    await propertyMutationCommitter.commitDirect(getCommitContext(item), 'visual.position', { x, y })
    clearVisualPositionOverlay(item.id)
  }

  async function commitSizeDeferredUpdate(
    axis: 'width' | 'height',
    nextValue?: number,
  ) {
    const item = selectedTimelineItem.value
    if (!item || !canOperateVisualChannels.value) return

    const sizeOverlay = getVisualSizeOverlay(item.id)
    const currentRenderConfig = visualRenderConfig.value
    const resolvedValue =
      typeof nextValue === 'number'
        ? nextValue
        : sizeOverlay?.[axis] ?? currentRenderConfig?.[axis]

    if (!isFiniteNumber(resolvedValue)) {
      return
    }

    const patch =
      axis === 'width'
        ? proportionalScale.value
          ? getScaledSizeFromWidth(resolvedValue)
          : { width: resolvedValue }
        : proportionalScale.value
          ? getScaledSizeFromHeight(resolvedValue)
          : { height: resolvedValue }

    await propertyMutationCommitter.commitDirect(getCommitContext(item), 'visual.size', patch)
    clearVisualSizeOverlay(item.id)
  }

  async function commitBlendIntensityDeferredUpdate(nextValue?: number) {
    const item = selectedTimelineItem.value
    if (!item || !canOperateVisualChannels.value) return

    const blendIntensityOverlay = getVisualBlendIntensityOverlay(item.id)
    const currentRenderConfig = visualRenderConfig.value
    const nextBlendIntensity =
      typeof nextValue === 'number'
        ? nextValue
        : blendIntensityOverlay?.blendIntensity ?? currentRenderConfig?.blendIntensity

    if (!isFiniteNumber(nextBlendIntensity)) return

    await propertyMutationCommitter.commitDirect(getCommitContext(item), 'visual.blendIntensity', nextBlendIntensity)
    clearVisualBlendIntensityOverlay(item.id)
  }

  async function commitVolumeDeferredUpdate(nextValue?: number) {
    const item = selectedTimelineItem.value
    if (!item || !canOperateVisualChannels.value) return

    const volumeOverlay = getAudioVolumeOverlay(item.id)
    const currentRenderConfig = audioRenderConfig.value
    const nextVolume =
      typeof nextValue === 'number'
        ? nextValue
        : volumeOverlay?.volume ?? currentRenderConfig?.volume

    if (!isFiniteNumber(nextVolume)) return

    await propertyMutationCommitter.commitDirect(getCommitContext(item), 'audio.volume', nextVolume)
    clearAudioVolumeOverlay(item.id)
  }

  async function commitVisualGeometryDeferredUpdate() {
    const item = selectedTimelineItem.value
    if (!item || !canOperateVisualChannels.value) return

    const sizeOverlay = getVisualSizeOverlay(item.id)
    const positionOverlay = getVisualPositionOverlay(item.id)
    if (!sizeOverlay && !positionOverlay) return

    const currentRenderConfig = visualRenderConfig.value
    const operations: ChangeOperation[] = []

    if (sizeOverlay) {
      const width = sizeOverlay.width ?? currentRenderConfig?.width
      const height = sizeOverlay.height ?? currentRenderConfig?.height
      if (isFiniteNumber(width) && isFiniteNumber(height)) {
        const sizePlan = propertyMutationCommitter.createDirectPlan(
          getCommitContext(item),
          'visual.size',
          { width, height },
        )
        operations.push(...sizePlan.operations)
      }
    }

    if (positionOverlay) {
      const x = positionOverlay.x ?? currentRenderConfig?.x
      const y = positionOverlay.y ?? currentRenderConfig?.y
      if (isFiniteNumber(x) && isFiniteNumber(y)) {
        const positionPlan = propertyMutationCommitter.createDirectPlan(
          getCommitContext(item),
          'visual.position',
          { x, y },
        )
        operations.push(...positionPlan.operations)
      }
    }

    if (operations.length === 0) return

    await propertyMutationCommitter.commitChangePlan(getCommitContext(item), {
      propertyId: 'visual.size',
      description: '修改尺寸和位置',
      operations,
    })
    clearVisualSizeOverlay(item.id)
    clearVisualPositionOverlay(item.id)
  }

  async function setPositionPatchDirectly(value: Record<string, number>) {
    const item = selectedTimelineItem.value
    if (!item || !canOperateVisualChannels.value) return
    await propertyMutationCommitter.commitDirect(getCommitContext(item), 'visual.position', value)
  }

  const setVisualPositionDeferred = (x: number, y: number) => {
    const item = selectedTimelineItem.value
    if (!item || !canOperateVisualChannels.value) return
    setVisualPositionOverlay(item.id, { x, y })
  }

  const setVisualXDeferred = (x: number) => {
    const item = selectedTimelineItem.value
    if (!item || !canOperateVisualChannels.value) return
    setVisualPositionOverlay(item.id, { x })
  }

  const setVisualYDeferred = (y: number) => {
    const item = selectedTimelineItem.value
    if (!item || !canOperateVisualChannels.value) return
    setVisualPositionOverlay(item.id, { y })
  }

  const setVisualSizeDeferred = (width: number, height: number, x?: number, y?: number) => {
    const item = selectedTimelineItem.value
    if (!item || !canOperateVisualChannels.value) return
    setVisualSizeOverlay(item.id, { width, height })
    if (typeof x === 'number' || typeof y === 'number') {
      const positionPatch: Record<string, number> = {}
      if (typeof x === 'number') positionPatch.x = x
      if (typeof y === 'number') positionPatch.y = y
      setVisualPositionOverlay(item.id, positionPatch)
    }
  }

  const setVisualRotationDeferred = (nextRotation: number) => {
    const item = selectedTimelineItem.value
    if (!item || !canOperateVisualChannels.value) return
    setVisualRotationOverlay(item.id, normalizeAngle(nextRotation))
  }

  const setRotationDeferred = (nextRotation: number) => {
    setVisualRotationDeferred(nextRotation)
  }

  const commitVisualXDeferredUpdate = async (x: number) => {
    await commitPositionDeferredUpdate('x', x)
  }

  const commitVisualYDeferredUpdate = async (y: number) => {
    await commitPositionDeferredUpdate('y', y)
  }

  const setWidthDeferred = (width: number) => {
    const item = selectedTimelineItem.value
    if (!item || !canOperateVisualChannels.value) return
    if (proportionalScale.value) {
      setVisualSizeOverlay(item.id, getScaledSizeFromWidth(width))
      return
    }
    setVisualSizeOverlay(item.id, { width })
  }

  const setHeightDeferred = (height: number) => {
    const item = selectedTimelineItem.value
    if (!item || !canOperateVisualChannels.value) return
    if (proportionalScale.value) {
      setVisualSizeOverlay(item.id, getScaledSizeFromHeight(height))
      return
    }
    setVisualSizeOverlay(item.id, { height })
  }

  const commitWidthDeferredUpdate = async (width: number) => {
    await commitSizeDeferredUpdate('width', width)
  }

  const commitHeightDeferredUpdate = async (height: number) => {
    await commitSizeDeferredUpdate('height', height)
  }

  const setBlendIntensityDeferred = (nextBlendIntensity: number) => {
    const item = selectedTimelineItem.value
    if (!item || !canOperateVisualChannels.value) return
    setVisualBlendIntensityOverlay(item.id, nextBlendIntensity)
  }

  const updateVolumeDeferred = (nextVolume: number) => {
    const item = selectedTimelineItem.value
    if (!item || !canOperateVisualChannels.value) return
    setAudioVolumeOverlay(item.id, nextVolume)
  }

  const setVisualXDirectly = async (x: number) => {
    await setPositionPatchDirectly({ x })
  }

  const setVisualYDirectly = async (y: number) => {
    await setPositionPatchDirectly({ y })
  }

  const setSizeDirectly = async (width: number, height: number) => {
    const item = selectedTimelineItem.value
    if (!item || !canOperateVisualChannels.value) return
    await propertyMutationCommitter.commitDirect(getCommitContext(item), 'visual.size', { width, height })
  }

  const setSizePatchDirectly = async (value: Record<string, number>) => {
    const item = selectedTimelineItem.value
    if (!item || !canOperateVisualChannels.value) return
    await propertyMutationCommitter.commitDirect(getCommitContext(item), 'visual.size', value)
  }

  const setWidthDirectly = async (width: number) => {
    if (proportionalScale.value) {
      await setSizePatchDirectly(getScaledSizeFromWidth(width))
      return
    }
    await setSizePatchDirectly({ width })
  }

  const setHeightDirectly = async (height: number) => {
    if (proportionalScale.value) {
      await setSizePatchDirectly(getScaledSizeFromHeight(height))
      return
    }
    await setSizePatchDirectly({ height })
  }

  const applyScalePreset = async (mode: 'fit' | 'fill') => {
    if (elementWidth.value <= 0 || elementHeight.value <= 0) return

    const canvasWidth = unifiedStore.videoResolution.width
    const canvasHeight = unifiedStore.videoResolution.height
    const scale =
      mode === 'fit'
        ? Math.min(canvasWidth / elementWidth.value, canvasHeight / elementHeight.value)
        : Math.max(canvasWidth / elementWidth.value, canvasHeight / elementHeight.value)

    await setSizeDirectly(
      Math.round(elementWidth.value * scale),
      Math.round(elementHeight.value * scale),
    )
  }

  const fitToCanvas = async () => {
    await applyScalePreset('fit')
  }

  const fillCanvas = async () => {
    await applyScalePreset('fill')
  }

  const setRotationDirectly = async (nextRotation: number) => {
    const item = selectedTimelineItem.value
    if (!item || !canOperateVisualChannels.value) return
    clearVisualRotationOverlay(item.id)
    await propertyMutationCommitter.commitDirect(
      getCommitContext(item),
      'visual.rotation',
      normalizeAngle(nextRotation),
    )
  }

  const setBlendIntensityDirectly = async (nextBlendIntensity: number) => {
    const item = selectedTimelineItem.value
    if (!item || !canOperateVisualChannels.value) return
    await propertyMutationCommitter.commitDirect(getCommitContext(item), 'visual.blendIntensity', nextBlendIntensity)
  }

  const setBlendModeDirectly = async (nextBlendMode: BlendMode) => {
    const item = selectedTimelineItem.value
    if (!item || !canOperateVisualChannels.value || !TimelineItemQueries.hasVisualProperties(item)) return
    if (!isBlendMode(nextBlendMode)) return

    await propertyMutationCommitter.commitConfigPatch(getCommitContext(item), {
      propertyId: 'visual.blendMode',
      description: '修改混合模式',
      operations: [
        {
          kind: 'visual-config-patch',
          timelineItemId: item.id,
          frame: currentFrame.value,
          patch: { blendMode: nextBlendMode },
        },
      ],
    })
  }

  const setVolume = async (nextVolume: number) => {
    const item = selectedTimelineItem.value
    if (!item || !canOperateVisualChannels.value) return
    await propertyMutationCommitter.commitDirect(getCommitContext(item), 'audio.volume', nextVolume)
  }

  const setMutedDirectly = async (nextMuted: boolean) => {
    const item = selectedTimelineItem.value
    if (!item || !canOperateVisualChannels.value || !TimelineItemQueries.hasAudioProperties(item)) return

    await propertyMutationCommitter.commitConfigPatch(getCommitContext(item), {
      propertyId: 'audio.isMuted',
      description: nextMuted ? '静音音频' : '取消静音音频',
      operations: [
        {
          kind: 'audio-config-patch',
          timelineItemId: item.id,
          frame: currentFrame.value,
          patch: { isMuted: nextMuted },
        },
      ],
    })
  }

  const toggleProportionalScale = async () => {
    const item = selectedTimelineItem.value
    if (!item || !canOperateVisualChannels.value || !TimelineItemQueries.hasVisualProperties(item)) return

    const nextProportionalScale = !TimelineItemQueries.getResolvedRenderConfig(item).visual.proportionalScale
    const operations: ChangeOperation[] = [
      {
        kind: 'visual-config-patch' as const,
        timelineItemId: item.id,
        frame: currentFrame.value,
        patch: { proportionalScale: nextProportionalScale },
      },
    ]

    if (nextProportionalScale) {
      const currentWidth = displayWidth.value
      const sizePatch = getScaledSizeFromWidth(currentWidth)
      if (typeof sizePatch.height === 'number') {
        const sizePlan = propertyMutationCommitter.createDirectPlan(
          getCommitContext(item),
          'visual.size',
          sizePatch,
        )
        operations.push(...sizePlan.operations)
      }
    }

    await propertyMutationCommitter.commitConfigPatch(getCommitContext(item), {
      propertyId: 'visual.proportionalScale',
      description: `${nextProportionalScale ? '开启' : '关闭'}等比缩放`,
      operations,
    })
  }

  const alignHorizontal = async (mode: 'left' | 'center' | 'right') => {
    const item = selectedTimelineItem.value
    const currentRenderConfig = visualRenderConfig.value
    if (!item || !canOperateVisualChannels.value || !currentRenderConfig) return

    const canvasWidth = unifiedStore.videoResolution.width
    const itemWidth = currentRenderConfig.width ?? 0
    const targetX =
      mode === 'left'
        ? -canvasWidth / 2 + itemWidth / 2
        : mode === 'right'
          ? canvasWidth / 2 - itemWidth / 2
          : 0

    await setPositionPatchDirectly({ x: targetX })
  }

  const alignVertical = async (mode: 'top' | 'middle' | 'bottom') => {
    const item = selectedTimelineItem.value
    const currentRenderConfig = visualRenderConfig.value
    if (!item || !canOperateVisualChannels.value || !currentRenderConfig) return

    const canvasHeight = unifiedStore.videoResolution.height
    const itemHeight = currentRenderConfig.height ?? 0
    const targetY =
      mode === 'top'
        ? canvasHeight / 2 - itemHeight / 2
        : mode === 'bottom'
          ? -canvasHeight / 2 + itemHeight / 2
          : 0

    await setPositionPatchDirectly({ y: targetY })
  }

  return {
    canOperateVisualChannels,
    visualX,
    visualY,
    displayWidth,
    displayHeight,
    rotation,
    blendIntensity,
    blendMode,
    volume,
    proportionalScale,
    elementWidth,
    elementHeight,
    setVisualPositionDeferred,
    setVisualXDeferred,
    setVisualYDeferred,
    setVisualSizeDeferred,
    setVisualRotationDeferred,
    setWidthDeferred,
    setHeightDeferred,
    setRotationDeferred,
    setBlendIntensityDeferred,
    updateVolumeDeferred,
    commitVisualXDeferredUpdate,
    commitVisualYDeferredUpdate,
    commitWidthDeferredUpdate,
    commitHeightDeferredUpdate,
    commitVisualPositionDeferredUpdate,
    commitVisualGeometryDeferredUpdate,
    commitRotationDeferredUpdate,
    commitBlendIntensityDeferredUpdate,
    commitVolumeDeferredUpdate,
    setVisualXDirectly,
    setVisualYDirectly,
    setWidthDirectly,
    setHeightDirectly,
    setSizeDirectly,
    fitToCanvas,
    fillCanvas,
    setRotationDirectly,
    setBlendIntensityDirectly,
    setBlendModeDirectly,
    setVolume,
    setMutedDirectly,
    toggleProportionalScale,
    alignHorizontal,
    alignVertical,
    getChannelButtonState,
    getChannelKeyframeUIState,
    hasPreviousChannelKeyframe,
    hasNextChannelKeyframe,
    goToPreviousChannelKeyframe,
    goToNextChannelKeyframe,
    toggleChannelKeyframe,
    getChannelKeyframeTooltip,
  }
}

export const useUnifiedKeyframeTransformControls = useUnifiedKeyframeVisualControls
