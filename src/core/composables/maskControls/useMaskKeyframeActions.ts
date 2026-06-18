import type { ComputedRef } from 'vue'
import { useAppI18n } from '@/core/composables/useI18n'
import type { useUnifiedStore } from '@/core/unifiedStore'
import { propertyMutationCommitter, type ChangePlan } from '@/core/property-system'
import {
  clearMaskCenterOverlay,
  clearMaskFeatherOverlay,
  clearMaskIntensityOverlay,
  clearMaskEllipseSizeOverlay,
  clearMaskRectangleSizeOverlay,
  clearMaskRectangleCornerRadiusOverlay,
  clearMaskMirrorLengthOverlay,
  getMaskCenterOverlay,
  getMaskFeatherOverlay,
  getMaskIntensityOverlay,
  getMaskEllipseSizeOverlay,
  getMaskRectangleSizeOverlay,
  getMaskRectangleCornerRadiusOverlay,
  getMaskMirrorLengthOverlay,
  setMaskCenterOverlay,
  setMaskFeatherOverlay,
  setMaskIntensityOverlay,
  setMaskEllipseSizeOverlay,
  setMaskRectangleSizeOverlay,
  setMaskRectangleCornerRadiusOverlay,
  setMaskMirrorLengthOverlay,
  clearMaskRotationOverlay,
  getMaskRotationOverlay,
  setMaskRotationOverlay,
} from '@/core/property-system/render-state'
import { TimelineItemQueries } from '@/core/timelineitem/queries'
import type { MaskPropertyPath, MaskType } from '@/core/timelineitem/mask'
import { getItemLocalSize, normalizeMaskConfig, replaceMaskType } from '@/core/timelineitem/mask'
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

function throwClipPropertyPhase0Todo(action: string): never {
  throw new Error(
    `[ClipProperty Phase 0 TODO] 属性区入口 "${action}" 仍在 mask controls 内部实现提交分流，` +
      '需先收敛到统一的属性提交入口后再恢复。',
  )
}

export function useMaskKeyframeActions(options: MaskKeyframeActionsOptions) {
  const { selectedTimelineItem, currentFrame, unifiedStore, canOperateMaskNumbers } = options
  const { t } = useAppI18n()

  function getCommitContext(item: NonNullable<typeof selectedTimelineItem.value>) {
    return {
      item,
      frame: currentFrame.value,
      applyChangePlan: unifiedStore.applyChangePlanWithHistory,
    }
  }

  function getMaskPlanContext(item: NonNullable<typeof selectedTimelineItem.value>) {
    const visualConfig = TimelineItemQueries.hasVisualProperties(item)
      ? TimelineItemQueries.getRenderConfig(item).visual
      : undefined
    const itemLocalSize = getItemLocalSize(visualConfig?.width ?? 0, visualConfig?.height ?? 0)
    const currentMask = normalizeMaskConfig(TimelineItemQueries.getMask(item), itemLocalSize)

    return { currentMask, itemLocalSize }
  }

  function createMaskEnabledPlan(item: NonNullable<typeof selectedTimelineItem.value>, value: boolean): ChangePlan {
    const { currentMask } = getMaskPlanContext(item)

    return {
      propertyId: 'mask.enabled',
      description: value ? '启用蒙版' : '关闭蒙版',
      operations: [
        {
          kind: 'extra-render-config-patch',
          timelineItemId: item.id,
          frame: currentFrame.value,
          patch: {
            mask: {
              ...currentMask,
              enabled: value,
            },
          },
        },
      ],
    }
  }

  function createMaskTypePlan(item: NonNullable<typeof selectedTimelineItem.value>, value: MaskType): ChangePlan {
    const { currentMask, itemLocalSize } = getMaskPlanContext(item)

    return {
      propertyId: 'mask.type',
      description: '修改蒙版类型',
      operations: [
        {
          kind: 'extra-render-config-patch',
          timelineItemId: item.id,
          frame: currentFrame.value,
          patch: {
            mask: replaceMaskType(currentMask, value, itemLocalSize),
          },
        },
      ],
    }
  }

  function createMaskInvertedPlan(item: NonNullable<typeof selectedTimelineItem.value>, value: boolean): ChangePlan {
    const { currentMask } = getMaskPlanContext(item)

    return {
      propertyId: 'mask.inverted',
      description: value ? '开启蒙版反相' : '关闭蒙版反相',
      operations: [
        {
          kind: 'extra-render-config-patch',
          timelineItemId: item.id,
          frame: currentFrame.value,
          patch: {
            mask: {
              ...currentMask,
              inverted: value,
            },
          },
        },
      ],
    }
  }

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
    if (path === 'mask.decayRate') {
      const item = selectedTimelineItem.value
      if (!item || !canOperateMaskNumbers.value) return
      clearMaskIntensityOverlay(item.id)
      await propertyMutationCommitter.commitDirect(getCommitContext(item), 'mask.intensity', value)
      return
    }

    if (path === 'mask.outerRange') {
      const item = selectedTimelineItem.value
      if (!item || !canOperateMaskNumbers.value) return
      clearMaskFeatherOverlay(item.id)
      await propertyMutationCommitter.commitDirect(getCommitContext(item), 'mask.feather', value)
      return
    }

    if (path === 'mask.width' || path === 'mask.height') {
      const item = selectedTimelineItem.value
      if (!item || !canOperateMaskNumbers.value) return
      clearMaskRectangleSizeOverlay(item.id)
      await propertyMutationCommitter.commitDirect(getCommitContext(item), 'mask.rectangle.size', {
        [path === 'mask.width' ? 'width' : 'height']: value,
      })
      return
    }

    if (path === 'mask.ellipseWidth' || path === 'mask.ellipseHeight') {
      const item = selectedTimelineItem.value
      if (!item || !canOperateMaskNumbers.value) return
      clearMaskEllipseSizeOverlay(item.id)
      await propertyMutationCommitter.commitDirect(getCommitContext(item), 'mask.ellipse.size', {
        [path === 'mask.ellipseWidth' ? 'ellipseWidth' : 'ellipseHeight']: value,
      })
      return
    }

    if (path === 'mask.centerX' || path === 'mask.centerY') {
      const item = selectedTimelineItem.value
      if (!item || !canOperateMaskNumbers.value) return
      clearMaskCenterOverlay(item.id)
      await propertyMutationCommitter.commitDirect(getCommitContext(item), 'mask.center', {
        [path === 'mask.centerX' ? 'centerX' : 'centerY']: value,
      })
      return
    }

    if (path === 'mask.rotation') {
      const item = selectedTimelineItem.value
      if (!item || !canOperateMaskNumbers.value) return
      clearMaskRotationOverlay(item.id)
      await propertyMutationCommitter.commitDirect(getCommitContext(item), 'mask.rotation', value)
      return
    }

    if (path === 'mask.cornerRadius') {
      const item = selectedTimelineItem.value
      if (!item || !canOperateMaskNumbers.value) return
      clearMaskRectangleCornerRadiusOverlay(item.id)
      await propertyMutationCommitter.commitDirect(
        getCommitContext(item),
        'mask.rectangle.cornerRadius',
        value,
      )
      return
    }

    if (path === 'mask.length') {
      const item = selectedTimelineItem.value
      if (!item || !canOperateMaskNumbers.value) return
      clearMaskMirrorLengthOverlay(item.id)
      await propertyMutationCommitter.commitDirect(getCommitContext(item), 'mask.mirror.length', value)
      return
    }

    throwClipPropertyPhase0Todo(`mask.property.set.${path}`)
  }

  async function setEnabled(value: boolean) {
    const item = selectedTimelineItem.value
    if (!item) return
    await propertyMutationCommitter.commitConfigPatch(getCommitContext(item), createMaskEnabledPlan(item, value))
  }

  async function setType(value: MaskType) {
    const item = selectedTimelineItem.value
    if (!item) return
    clearMaskRotationOverlay(item.id)
    await propertyMutationCommitter.commitConfigPatch(getCommitContext(item), createMaskTypePlan(item, value))
  }

  async function setInverted(value: boolean) {
    const item = selectedTimelineItem.value
    if (!item) return
    await propertyMutationCommitter.commitConfigPatch(getCommitContext(item), createMaskInvertedPlan(item, value))
  }

  async function toggleMaskKeyframe(channel: MaskChannelKey) {
    if (channel === 'mask.intensity') {
      const item = selectedTimelineItem.value
      if (!item || !canOperateMaskNumbers.value) return
      clearMaskIntensityOverlay(item.id)
      await propertyMutationCommitter.toggleKeyframe(getCommitContext(item), 'mask.intensity')
      return
    }

    if (channel === 'mask.feather') {
      const item = selectedTimelineItem.value
      if (!item || !canOperateMaskNumbers.value) return
      clearMaskFeatherOverlay(item.id)
      await propertyMutationCommitter.toggleKeyframe(getCommitContext(item), 'mask.feather')
      return
    }

    if (channel === 'mask.center') {
      const item = selectedTimelineItem.value
      if (!item || !canOperateMaskNumbers.value) return
      clearMaskCenterOverlay(item.id)
      await propertyMutationCommitter.toggleKeyframe(getCommitContext(item), 'mask.center')
      return
    }

    if (channel === 'mask.rectangle.size') {
      const item = selectedTimelineItem.value
      if (!item || !canOperateMaskNumbers.value) return
      clearMaskRectangleSizeOverlay(item.id)
      await propertyMutationCommitter.toggleKeyframe(getCommitContext(item), 'mask.rectangle.size')
      return
    }

    if (channel === 'mask.ellipse.size') {
      const item = selectedTimelineItem.value
      if (!item || !canOperateMaskNumbers.value) return
      clearMaskEllipseSizeOverlay(item.id)
      await propertyMutationCommitter.toggleKeyframe(getCommitContext(item), 'mask.ellipse.size')
      return
    }

    if (channel === 'mask.rotation') {
      const item = selectedTimelineItem.value
      if (!item || !canOperateMaskNumbers.value) return
      clearMaskRotationOverlay(item.id)
      await propertyMutationCommitter.toggleKeyframe(getCommitContext(item), 'mask.rotation')
      return
    }

    if (channel === 'mask.rectangle.cornerRadius') {
      const item = selectedTimelineItem.value
      if (!item || !canOperateMaskNumbers.value) return
      clearMaskRectangleCornerRadiusOverlay(item.id)
      await propertyMutationCommitter.toggleKeyframe(
        getCommitContext(item),
        'mask.rectangle.cornerRadius',
      )
      return
    }

    if (channel === 'mask.mirror.length') {
      const item = selectedTimelineItem.value
      if (!item || !canOperateMaskNumbers.value) return
      clearMaskMirrorLengthOverlay(item.id)
      await propertyMutationCommitter.toggleKeyframe(getCommitContext(item), 'mask.mirror.length')
      return
    }

    throwClipPropertyPhase0Todo(`mask.keyframe.toggle.${channel}`)
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

  function setMaskRotationDeferred(value: number) {
    const item = selectedTimelineItem.value
    if (!item || !canOperateMaskNumbers.value) return
    setMaskRotationOverlay(item.id, value)
  }

  function setMaskOuterRangeDeferred(value: number) {
    const item = selectedTimelineItem.value
    if (!item || !canOperateMaskNumbers.value) return
    setMaskFeatherOverlay(item.id, value)
  }

  function setMaskDecayRateDeferred(value: number) {
    const item = selectedTimelineItem.value
    if (!item || !canOperateMaskNumbers.value) return
    setMaskIntensityOverlay(item.id, value)
  }

  function setMaskCenterDeferred(centerX: number, centerY: number) {
    const item = selectedTimelineItem.value
    if (!item || !canOperateMaskNumbers.value) return
    setMaskCenterOverlay(item.id, { centerX, centerY })
  }

  function setMaskRectangleSizeDeferred(width: number, height: number) {
    const item = selectedTimelineItem.value
    if (!item || !canOperateMaskNumbers.value) return
    setMaskRectangleSizeOverlay(item.id, { width, height })
  }

  function setMaskEllipseSizeDeferred(ellipseWidth: number, ellipseHeight: number) {
    const item = selectedTimelineItem.value
    if (!item || !canOperateMaskNumbers.value) return
    setMaskEllipseSizeOverlay(item.id, { ellipseWidth, ellipseHeight })
  }

  function setMaskRectangleCornerRadiusDeferred(value: number) {
    const item = selectedTimelineItem.value
    if (!item || !canOperateMaskNumbers.value) return
    setMaskRectangleCornerRadiusOverlay(item.id, value)
  }

  function setMaskMirrorLengthDeferred(value: number) {
    const item = selectedTimelineItem.value
    if (!item || !canOperateMaskNumbers.value) return
    setMaskMirrorLengthOverlay(item.id, value)
  }

  async function commitMaskCenterDeferredUpdate() {
    const item = selectedTimelineItem.value
    if (!item || !canOperateMaskNumbers.value) return
    const overlay = getMaskCenterOverlay(item.id)
    if (!overlay) return
    const { currentMask } = getMaskPlanContext(item)
    const centerX = overlay.centerX ?? currentMask.centerX
    const centerY = overlay.centerY ?? currentMask.centerY
    clearMaskCenterOverlay(item.id)
    await propertyMutationCommitter.commitDirect(getCommitContext(item), 'mask.center', { centerX, centerY })
  }

  async function commitMaskRectangleSizeDeferredUpdate() {
    const item = selectedTimelineItem.value
    if (!item || !canOperateMaskNumbers.value) return
    const overlay = getMaskRectangleSizeOverlay(item.id)
    if (!overlay) return
    const { currentMask } = getMaskPlanContext(item)
    if (currentMask.type !== 'rectangle') return
    const width = overlay.width ?? currentMask.width
    const height = overlay.height ?? currentMask.height
    clearMaskRectangleSizeOverlay(item.id)
    await propertyMutationCommitter.commitDirect(getCommitContext(item), 'mask.rectangle.size', { width, height })
  }

  async function commitMaskFeatherDeferredUpdate(value?: number) {
    const item = selectedTimelineItem.value
    if (!item || !canOperateMaskNumbers.value) return
    const overlay = getMaskFeatherOverlay(item.id)
    const { currentMask } = getMaskPlanContext(item)
    const outerRange = typeof value === 'number' ? value : overlay?.outerRange ?? currentMask.falloff.outerRange
    if (!Number.isFinite(outerRange)) return
    clearMaskFeatherOverlay(item.id)
    await propertyMutationCommitter.commitDirect(getCommitContext(item), 'mask.feather', outerRange)
  }

  async function commitMaskIntensityDeferredUpdate(value?: number) {
    const item = selectedTimelineItem.value
    if (!item || !canOperateMaskNumbers.value) return
    const overlay = getMaskIntensityOverlay(item.id)
    const { currentMask } = getMaskPlanContext(item)
    const decayRate =
      typeof value === 'number' ? value : overlay?.decayRate ?? currentMask.falloff.decayRate
    if (!Number.isFinite(decayRate)) return
    clearMaskIntensityOverlay(item.id)
    await propertyMutationCommitter.commitDirect(getCommitContext(item), 'mask.intensity', decayRate)
  }

  async function commitMaskEllipseSizeDeferredUpdate() {
    const item = selectedTimelineItem.value
    if (!item || !canOperateMaskNumbers.value) return
    const overlay = getMaskEllipseSizeOverlay(item.id)
    if (!overlay) return
    const { currentMask } = getMaskPlanContext(item)
    if (currentMask.type !== 'ellipse') return
    const ellipseWidth = overlay.ellipseWidth ?? currentMask.ellipseWidth
    const ellipseHeight = overlay.ellipseHeight ?? currentMask.ellipseHeight
    clearMaskEllipseSizeOverlay(item.id)
    await propertyMutationCommitter.commitDirect(getCommitContext(item), 'mask.ellipse.size', {
      ellipseWidth,
      ellipseHeight,
    })
  }

  async function commitMaskRotationDeferredUpdate(value?: number) {
    const item = selectedTimelineItem.value
    if (!item || !canOperateMaskNumbers.value) return
    const overlay = getMaskRotationOverlay(item.id)
    const nextRotation = typeof value === 'number' ? value : overlay?.rotation
    if (typeof nextRotation !== 'number' || !Number.isFinite(nextRotation)) return
    clearMaskRotationOverlay(item.id)
    await propertyMutationCommitter.commitDirect(getCommitContext(item), 'mask.rotation', nextRotation)
  }

  async function commitMaskRectangleCornerRadiusDeferredUpdate(value?: number) {
    const item = selectedTimelineItem.value
    if (!item || !canOperateMaskNumbers.value) return
    const overlay = getMaskRectangleCornerRadiusOverlay(item.id)
    const { currentMask } = getMaskPlanContext(item)
    if (currentMask.type !== 'rectangle') return
    const cornerRadius =
      typeof value === 'number' ? value : overlay?.cornerRadius ?? currentMask.cornerRadius
    if (!Number.isFinite(cornerRadius)) return
    clearMaskRectangleCornerRadiusOverlay(item.id)
    await propertyMutationCommitter.commitDirect(
      getCommitContext(item),
      'mask.rectangle.cornerRadius',
      cornerRadius,
    )
  }

  async function commitMaskMirrorLengthDeferredUpdate(value?: number) {
    const item = selectedTimelineItem.value
    if (!item || !canOperateMaskNumbers.value) return
    const overlay = getMaskMirrorLengthOverlay(item.id)
    const { currentMask } = getMaskPlanContext(item)
    if (currentMask.type !== 'mirror') return
    const length = typeof value === 'number' ? value : overlay?.length ?? currentMask.length
    if (!Number.isFinite(length)) return
    clearMaskMirrorLengthOverlay(item.id)
    await propertyMutationCommitter.commitDirect(getCommitContext(item), 'mask.mirror.length', length)
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
    setMaskOuterRangeDeferred,
    commitMaskFeatherDeferredUpdate,
    setMaskDecayRateDeferred,
    commitMaskIntensityDeferredUpdate,
    setMaskCenterDeferred,
    commitMaskCenterDeferredUpdate,
    setMaskRectangleSizeDeferred,
    commitMaskRectangleSizeDeferredUpdate,
    setMaskEllipseSizeDeferred,
    commitMaskEllipseSizeDeferredUpdate,
    setMaskRotationDeferred,
    commitMaskRotationDeferredUpdate,
    setMaskRectangleCornerRadiusDeferred,
    commitMaskRectangleCornerRadiusDeferredUpdate,
    setMaskMirrorLengthDeferred,
    commitMaskMirrorLengthDeferredUpdate,
    toggleMaskKeyframe,
    goToPreviousMaskKeyframe,
    goToNextMaskKeyframe,
  }
}
