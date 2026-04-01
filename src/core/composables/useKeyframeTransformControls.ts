import { computed, type Ref } from 'vue'
import { useUnifiedStore } from '@/core/unifiedStore'
import type { UnifiedTimelineItemData } from '@/core/timelineitem'
import { TimelineItemQueries } from '@/core/timelineitem/queries'
import type { AnimationChannelKey, AnimationGroupId } from '@/core/timelineitem/bunnytype'
import {
  getKeyframeButtonState,
  getKeyframeUIState,
  getPreviousKeyframeFrame,
  getNextKeyframeFrame,
} from '@/core/utils/unifiedKeyframeUtils'
import { isPlayheadInTimelineItem } from '@/core/utils/timelineSearchUtils'
import { normalizeAngle } from '@/core/utils/rotationTransform'
import { AnimationSession } from '@/core/animation/session'
import type { BlendMode } from '@/core/timelineitem'

interface UnifiedKeyframeTransformControlsOptions {
  selectedTimelineItem: Ref<UnifiedTimelineItemData | null>
  currentFrame: Ref<number>
}

export function useUnifiedKeyframeTransformControls(
  options: UnifiedKeyframeTransformControlsOptions,
) {
  const { selectedTimelineItem, currentFrame } = options
  const unifiedStore = useUnifiedStore()
  const session = new AnimationSession()

  const canOperateTransforms = computed(() => {
    if (!selectedTimelineItem.value) return false
    return isPlayheadInTimelineItem(selectedTimelineItem.value, currentFrame.value)
  })

  const renderConfig = computed(() => {
    if (!selectedTimelineItem.value) return null
    return TimelineItemQueries.getRenderConfig(selectedTimelineItem.value)
  })

  function getOriginalDimensions() {
    const item = selectedTimelineItem.value
    if (!item || !TimelineItemQueries.hasVisualProperties(item)) {
      return { width: 0, height: 0 }
    }

    if (TimelineItemQueries.isTextTimelineItem(item)) {
      const currentRenderConfig = renderConfig.value as any
      return {
        width: item.runtime.textBitmap?.width ?? currentRenderConfig?.width ?? 0,
        height: item.runtime.textBitmap?.height ?? currentRenderConfig?.height ?? 0,
      }
    }

    const mediaItem = unifiedStore.getMediaItem(item.mediaItemId)
    const currentRenderConfig = renderConfig.value as any
    return {
      width: mediaItem?.runtime.bunny?.originalWidth ?? currentRenderConfig?.width ?? 0,
      height: mediaItem?.runtime.bunny?.originalHeight ?? currentRenderConfig?.height ?? 0,
    }
  }

  const transformX = computed(() => (renderConfig.value as any)?.x ?? 0)
  const transformY = computed(() => (renderConfig.value as any)?.y ?? 0)
  const displayWidth = computed(() => (renderConfig.value as any)?.width ?? 0)
  const displayHeight = computed(() => (renderConfig.value as any)?.height ?? 0)
  const rotation = computed(() => (renderConfig.value as any)?.rotation ?? 0)
  const opacity = computed(() => (renderConfig.value as any)?.opacity ?? 1)
  const blendMode = computed(() => (renderConfig.value as any)?.blendMode ?? 'normal')
  const volume = computed(() => (renderConfig.value as any)?.volume ?? 1)
  const elementWidth = computed(() => getOriginalDimensions().width)
  const elementHeight = computed(() => getOriginalDimensions().height)
  const proportionalScale = computed({
    get: () =>
      Boolean(
        selectedTimelineItem.value &&
        TimelineItemQueries.hasVisualProperties(selectedTimelineItem.value) &&
        selectedTimelineItem.value.config.proportionalScale,
      ),
    set: (value) => {
      if (selectedTimelineItem.value && TimelineItemQueries.hasVisualProperties(selectedTimelineItem.value)) {
        selectedTimelineItem.value.config.proportionalScale = value
      }
    },
  })
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

  const toggleChannelKeyframe = async (groupId: AnimationChannelKey) => {
    const item = selectedTimelineItem.value
    if (!item) return
    await unifiedStore.toggleKeyframeWithHistory(item.id, currentFrame.value, groupId)
  }

  const getChannelKeyframeTooltip = (groupId: AnimationChannelKey) => {
    if (!canOperateTransforms.value) {
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

  async function commitDeferredUpdates() {
    const item = selectedTimelineItem.value
    if (!item || !session.isActive) return
    const patches = session.commit(item)
    const updates = Object.entries(patches).map(([groupId, patch]) => ({
      groupId: groupId as AnimationGroupId,
      patch: patch as never,
    }))
    if (updates.length > 0) {
      await unifiedStore.updateAnimationGroupsBatchWithHistory(item.id, currentFrame.value, updates)
    }
  }

  function applyDeferredPatch<G extends AnimationGroupId>(
    groupId: G,
    patch: Record<string, number>,
  ) {
    const item = selectedTimelineItem.value
    if (!item || !canOperateTransforms.value) return
    session.apply(item, currentFrame.value, groupId, patch as never)
  }

  async function updateGroupDirect<G extends AnimationGroupId>(
    groupId: G,
    patch: Record<string, number>,
  ) {
    const item = selectedTimelineItem.value
    if (!item || !canOperateTransforms.value) return
    await unifiedStore.updateAnimationGroupValueWithHistory(
      item.id,
      currentFrame.value,
      groupId,
      patch as any,
    )
  }

  const setTransformPositionDeferred = (x: number, y: number) => {
    applyDeferredPatch('transform.position', { x, y })
  }

  const setTransformSizeDeferred = (width: number, height: number, x?: number, y?: number) => {
    applyDeferredPatch('transform.size', { width, height })
    if (typeof x === 'number' || typeof y === 'number') {
      const positionPatch: Record<string, number> = {}
      if (typeof x === 'number') positionPatch.x = x
      if (typeof y === 'number') positionPatch.y = y
      applyDeferredPatch('transform.position', positionPatch)
    }
  }

  const setTransformRotationDeferred = (nextRotation: number) => {
    applyDeferredPatch('transform.rotation', { rotation: normalizeAngle(nextRotation) })
  }

  const setRotationDeferred = (nextRotation: number) => {
    setTransformRotationDeferred(nextRotation)
  }

  const setWidthDeferred = (width: number) => {
    if (proportionalScale.value) {
      applyDeferredPatch('transform.size', getScaledSizeFromWidth(width))
      return
    }
    applyDeferredPatch('transform.size', { width })
  }

  const setHeightDeferred = (height: number) => {
    if (proportionalScale.value) {
      applyDeferredPatch('transform.size', getScaledSizeFromHeight(height))
      return
    }
    applyDeferredPatch('transform.size', { height })
  }

  const setOpacityDeferred = (nextOpacity: number) => {
    applyDeferredPatch('transform.opacity', { opacity: nextOpacity })
  }

  const updateVolumeDeferred = (nextVolume: number) => {
    applyDeferredPatch('audio.volume', { volume: nextVolume })
  }

  const setTransformXDirectly = async (x: number) => {
    await updateGroupDirect('transform.position', { x })
  }

  const setTransformYDirectly = async (y: number) => {
    await updateGroupDirect('transform.position', { y })
  }

  const setSizeDirectly = async (width: number, height: number) => {
    await updateGroupDirect('transform.size', { width, height })
  }

  const setWidthDirectly = async (width: number) => {
    if (proportionalScale.value) {
      await updateGroupDirect('transform.size', getScaledSizeFromWidth(width))
      return
    }
    await updateGroupDirect('transform.size', { width })
  }

  const setHeightDirectly = async (height: number) => {
    if (proportionalScale.value) {
      await updateGroupDirect('transform.size', getScaledSizeFromHeight(height))
      return
    }
    await updateGroupDirect('transform.size', { height })
  }

  const setRotationDirectly = async (nextRotation: number) => {
    await updateGroupDirect('transform.rotation', { rotation: normalizeAngle(nextRotation) })
  }

  const setOpacityDirectly = async (nextOpacity: number) => {
    await updateGroupDirect('transform.opacity', { opacity: nextOpacity })
  }

  const setBlendModeDirectly = async (nextBlendMode: BlendMode) => {
    const item = selectedTimelineItem.value
    if (!item || !canOperateTransforms.value) return
    await unifiedStore.updateTimelineItemTransformWithHistory(item.id, { blendMode: nextBlendMode })
  }

  const setVolume = async (nextVolume: number) => {
    await updateGroupDirect('audio.volume', { volume: nextVolume })
  }

  const toggleProportionalScale = async () => {
    const item = selectedTimelineItem.value
    if (!item) return
    await unifiedStore.toggleProportionalScaleWithHistory(item.id, currentFrame.value)
  }

  const alignHorizontal = async (mode: 'left' | 'center' | 'right') => {
    const width = (renderConfig.value as any)?.width ?? 0
    const canvasWidth = unifiedStore.videoResolution.width
    const x = mode === 'left'
      ? -(canvasWidth - width) / 2
      : mode === 'right'
        ? (canvasWidth - width) / 2
        : 0
    await updateGroupDirect('transform.position', { x })
  }

  const alignVertical = async (mode: 'top' | 'middle' | 'bottom') => {
    const height = (renderConfig.value as any)?.height ?? 0
    const canvasHeight = unifiedStore.videoResolution.height
    const y = mode === 'top'
      ? (canvasHeight - height) / 2
      : mode === 'bottom'
        ? -(canvasHeight - height) / 2
        : 0
    await updateGroupDirect('transform.position', { y })
  }

  return {
    canOperateTransforms,
    transformX,
    transformY,
    displayWidth,
    displayHeight,
    rotation,
    opacity,
    blendMode,
    volume,
    proportionalScale,
    elementWidth,
    elementHeight,
    setTransformPositionDeferred,
    setTransformSizeDeferred,
    setTransformRotationDeferred,
    setWidthDeferred,
    setHeightDeferred,
    setRotationDeferred,
    setOpacityDeferred,
    updateVolumeDeferred,
    commitDeferredUpdates,
    setTransformXDirectly,
    setTransformYDirectly,
    setWidthDirectly,
    setHeightDirectly,
    setSizeDirectly,
    setRotationDirectly,
    setOpacityDirectly,
    setBlendModeDirectly,
    setVolume,
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
