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
  const rotation = computed(() => (renderConfig.value as any)?.rotation ?? 0)
  const opacity = computed(() => (renderConfig.value as any)?.opacity ?? 1)
  const volume = computed(() => (renderConfig.value as any)?.volume ?? 1)
  const elementWidth = computed(() => getOriginalDimensions().width)
  const elementHeight = computed(() => getOriginalDimensions().height)
  const scaleX = computed(() => {
    const originalWidth = elementWidth.value
    return originalWidth > 0 ? ((renderConfig.value as any)?.width ?? 0) / originalWidth : 1
  })
  const scaleY = computed(() => {
    const originalHeight = elementHeight.value
    return originalHeight > 0 ? ((renderConfig.value as any)?.height ?? 0) / originalHeight : 1
  })
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
  const uniformScale = computed(() => scaleX.value)

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
    applyDeferredPatch('transform.layout', { x, y })
  }

  const setTransformSizeDeferred = (width: number, height: number, x?: number, y?: number) => {
    const patch: Record<string, number> = { width, height }
    if (typeof x === 'number') patch.x = x
    if (typeof y === 'number') patch.y = y
    applyDeferredPatch('transform.layout', patch)
  }

  const setTransformRotationDeferred = (nextRotation: number) => {
    applyDeferredPatch('transform.rotation', { rotation: normalizeAngle(nextRotation) })
  }

  const updateUniformScaleDeferred = (scale: number) => {
    const { width, height } = getOriginalDimensions()
    setTransformSizeDeferred(width * scale, height * scale)
  }

  const setScaleXDeferred = (scale: number) => {
    const { width, height } = getOriginalDimensions()
    const nextWidth = width * scale
    if (proportionalScale.value) {
      setTransformSizeDeferred(nextWidth, height * scale)
      return
    }
    applyDeferredPatch('transform.layout', { width: nextWidth })
  }

  const setScaleYDeferred = (scale: number) => {
    const { width, height } = getOriginalDimensions()
    const nextHeight = height * scale
    if (proportionalScale.value) {
      setTransformSizeDeferred(width * scale, nextHeight)
      return
    }
    applyDeferredPatch('transform.layout', { height: nextHeight })
  }

  const setRotationDeferred = (nextRotation: number) => {
    setTransformRotationDeferred(nextRotation)
  }

  const setOpacityDeferred = (nextOpacity: number) => {
    applyDeferredPatch('transform.opacity', { opacity: nextOpacity })
  }

  const updateVolumeDeferred = (nextVolume: number) => {
    applyDeferredPatch('audio.volume', { volume: nextVolume })
  }

  const setTransformXDirectly = async (x: number) => {
    await updateGroupDirect('transform.layout', { x })
  }

  const setTransformYDirectly = async (y: number) => {
    await updateGroupDirect('transform.layout', { y })
  }

  const setScaleXDirectly = async (scale: number) => {
    const { width, height } = getOriginalDimensions()
    if (proportionalScale.value) {
      await updateGroupDirect('transform.layout', { width: width * scale, height: height * scale })
      return
    }
    await updateGroupDirect('transform.layout', { width: width * scale })
  }

  const setScaleYDirectly = async (scale: number) => {
    const { width, height } = getOriginalDimensions()
    if (proportionalScale.value) {
      await updateGroupDirect('transform.layout', { width: width * scale, height: height * scale })
      return
    }
    await updateGroupDirect('transform.layout', { height: height * scale })
  }

  const updateUniformScaleDirectly = async (scale: number) => {
    const { width, height } = getOriginalDimensions()
    await updateGroupDirect('transform.layout', { width: width * scale, height: height * scale })
  }

  const setRotationDirectly = async (nextRotation: number) => {
    await updateGroupDirect('transform.rotation', { rotation: normalizeAngle(nextRotation) })
  }

  const setOpacityDirectly = async (nextOpacity: number) => {
    await updateGroupDirect('transform.opacity', { opacity: nextOpacity })
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
    await updateGroupDirect('transform.layout', { x })
  }

  const alignVertical = async (mode: 'top' | 'middle' | 'bottom') => {
    const height = (renderConfig.value as any)?.height ?? 0
    const canvasHeight = unifiedStore.videoResolution.height
    const y = mode === 'top'
      ? (canvasHeight - height) / 2
      : mode === 'bottom'
        ? -(canvasHeight - height) / 2
        : 0
    await updateGroupDirect('transform.layout', { y })
  }

  return {
    canOperateTransforms,
    transformX,
    transformY,
    scaleX,
    scaleY,
    rotation,
    opacity,
    volume,
    proportionalScale,
    uniformScale,
    elementWidth,
    elementHeight,
    setTransformPositionDeferred,
    setTransformSizeDeferred,
    setTransformRotationDeferred,
    updateUniformScaleDeferred,
    setScaleXDeferred,
    setScaleYDeferred,
    setRotationDeferred,
    setOpacityDeferred,
    updateVolumeDeferred,
    commitDeferredUpdates,
    setTransformXDirectly,
    setTransformYDirectly,
    setScaleXDirectly,
    setScaleYDirectly,
    setRotationDirectly,
    setOpacityDirectly,
    updateUniformScaleDirectly,
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
