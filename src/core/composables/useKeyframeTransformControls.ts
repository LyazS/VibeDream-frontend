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
import type { BlendMode } from '@/core/timelineitem'
import { propertyMutationService, type ChangeOperation } from '@/core/property-mutation'
import {
  clearTransformRotationOverlay,
  setTransformRotationOverlay,
} from '@/core/render-state'

interface UnifiedKeyframeTransformControlsOptions {
  selectedTimelineItem: Ref<UnifiedTimelineItemData | null>
  currentFrame: Ref<number>
}

function throwClipPropertyPhase0Todo(action: string): never {
  throw new Error(
    `[ClipProperty Phase 0 TODO] 属性区入口 "${action}" 仍在 useUnifiedKeyframeTransformControls 内部实现提交分流，` +
      '需先收敛到统一的属性提交入口后再恢复。',
  )
}

export function useUnifiedKeyframeTransformControls(
  options: UnifiedKeyframeTransformControlsOptions,
) {
  const { selectedTimelineItem, currentFrame } = options
  const unifiedStore = useUnifiedStore()

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
      throwClipPropertyPhase0Todo(`transform.proportionalScale.setter.${String(value)}`)
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
    if (groupId === 'transform.size') {
      const item = selectedTimelineItem.value
      if (!item || !canOperateTransforms.value) return
      const plan = propertyMutationService.plan({
        kind: 'keyframe-toggle',
        propertyId: 'transform.size',
        timelineItemId: item.id,
        frame: currentFrame.value,
        item,
      })
      await unifiedStore.applyChangePlanWithHistory(plan)
      return
    }

    if (groupId === 'transform.position') {
      const item = selectedTimelineItem.value
      if (!item || !canOperateTransforms.value) return
      const plan = propertyMutationService.plan({
        kind: 'keyframe-toggle',
        propertyId: 'transform.position',
        timelineItemId: item.id,
        frame: currentFrame.value,
        item,
      })
      await unifiedStore.applyChangePlanWithHistory(plan)
      return
    }

    if (groupId === 'transform.rotation') {
      const item = selectedTimelineItem.value
      if (!item || !canOperateTransforms.value) return
      clearTransformRotationOverlay(item.id)
      const plan = propertyMutationService.plan({
        kind: 'keyframe-toggle',
        propertyId: 'transform.rotation',
        timelineItemId: item.id,
        frame: currentFrame.value,
        item,
      })
      await unifiedStore.applyChangePlanWithHistory(plan)
      return
    }

    throwClipPropertyPhase0Todo(`transform.keyframe.toggle.${groupId}`)
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
    throwClipPropertyPhase0Todo('transform.deferred.commit')
  }

  async function commitRotationDeferredUpdate(nextValue?: number) {
    const item = selectedTimelineItem.value
    if (!item || !canOperateTransforms.value) return
    const nextRotation = typeof nextValue === 'number' ? normalizeAngle(nextValue) : rotation.value
    clearTransformRotationOverlay(item.id)
    const plan = propertyMutationService.plan({
      kind: 'direct',
      propertyId: 'transform.rotation',
      timelineItemId: item.id,
      frame: currentFrame.value,
      value: nextRotation,
      item,
    })
    await unifiedStore.applyChangePlanWithHistory(plan)
  }

  function applyDeferredPatch<G extends AnimationGroupId>(
    groupId: G,
    patch: Record<string, number>,
  ) {
    throwClipPropertyPhase0Todo(`transform.deferred.applyPatch.${groupId}`)
  }

  async function updateGroupDirect<G extends AnimationGroupId>(
    groupId: G,
    patch: Record<string, number>,
  ) {
    throwClipPropertyPhase0Todo(`transform.direct.updateGroup.${groupId}`)
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
    const item = selectedTimelineItem.value
    if (!item || !canOperateTransforms.value) return
    setTransformRotationOverlay(item.id, normalizeAngle(nextRotation))
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
    const item = selectedTimelineItem.value
    if (!item || !canOperateTransforms.value) return
    const plan = propertyMutationService.plan({
      kind: 'direct',
      propertyId: 'transform.position',
      timelineItemId: item.id,
      frame: currentFrame.value,
      value: { x },
      item,
    })
    await unifiedStore.applyChangePlanWithHistory(plan)
  }

  const setTransformYDirectly = async (y: number) => {
    const item = selectedTimelineItem.value
    if (!item || !canOperateTransforms.value) return
    const plan = propertyMutationService.plan({
      kind: 'direct',
      propertyId: 'transform.position',
      timelineItemId: item.id,
      frame: currentFrame.value,
      value: { y },
      item,
    })
    await unifiedStore.applyChangePlanWithHistory(plan)
  }

  const setSizeDirectly = async (width: number, height: number) => {
    const item = selectedTimelineItem.value
    if (!item || !canOperateTransforms.value) return
    const plan = propertyMutationService.plan({
      kind: 'direct',
      propertyId: 'transform.size',
      timelineItemId: item.id,
      frame: currentFrame.value,
      value: { width, height },
      item,
    })
    await unifiedStore.applyChangePlanWithHistory(plan)
  }

  const setSizePatchDirectly = async (value: Record<string, number>) => {
    const item = selectedTimelineItem.value
    if (!item || !canOperateTransforms.value) return
    const plan = propertyMutationService.plan({
      kind: 'direct',
      propertyId: 'transform.size',
      timelineItemId: item.id,
      frame: currentFrame.value,
      value,
      item,
    })
    await unifiedStore.applyChangePlanWithHistory(plan)
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

  const setRotationDirectly = async (nextRotation: number) => {
    const item = selectedTimelineItem.value
    if (!item || !canOperateTransforms.value) return
    clearTransformRotationOverlay(item.id)
    const plan = propertyMutationService.plan({
      kind: 'direct',
      propertyId: 'transform.rotation',
      timelineItemId: item.id,
      frame: currentFrame.value,
      value: normalizeAngle(nextRotation),
      item,
    })
    await unifiedStore.applyChangePlanWithHistory(plan)
  }

  const setOpacityDirectly = async (nextOpacity: number) => {
    await updateGroupDirect('transform.opacity', { opacity: nextOpacity })
  }

  const setBlendModeDirectly = async (nextBlendMode: BlendMode) => {
    throwClipPropertyPhase0Todo(`transform.blendMode.direct.${nextBlendMode}`)
  }

  const setVolume = async (nextVolume: number) => {
    await updateGroupDirect('audio.volume', { volume: nextVolume })
  }

  const toggleProportionalScale = async () => {
    const item = selectedTimelineItem.value
    if (!item || !canOperateTransforms.value || !TimelineItemQueries.hasVisualProperties(item)) return

    const nextProportionalScale = !item.config.proportionalScale
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
        const sizePlan = propertyMutationService.plan({
          kind: 'direct',
          propertyId: 'transform.size',
          timelineItemId: item.id,
          frame: currentFrame.value,
          value: sizePatch,
          item,
        })
        operations.push(...sizePlan.operations)
      }
    }

    await unifiedStore.applyChangePlanWithHistory({
      propertyId: 'transform.size',
      description: `${nextProportionalScale ? '开启' : '关闭'}等比缩放`,
      operations,
    })
  }

  const alignHorizontal = async (mode: 'left' | 'center' | 'right') => {
    throwClipPropertyPhase0Todo(`transform.alignHorizontal.${mode}`)
  }

  const alignVertical = async (mode: 'top' | 'middle' | 'bottom') => {
    throwClipPropertyPhase0Todo(`transform.alignVertical.${mode}`)
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
    commitRotationDeferredUpdate,
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
