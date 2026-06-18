<template>
  <div
    :class="overlayClasses"
    :style="overlayStyles"
    :data-transition-source-id="overlay.sourceItemId"
    :data-timeline-selection-id="overlay.selectionId"
    :data-transition-binding-state="overlay.bindingState"
    @click.stop="handleSelect"
    @contextmenu.stop.prevent="handleContextMenu"
  >
    <div v-if="hasPackageWarning" class="timeline-transition-overlay__warning">
      <component :is="IconComponents.WARNING" size="12px" />
    </div>

    <div
      v-if="isSelected"
      class="resize-handle resize-handle-left"
      @mousedown.stop="handleResizeStart('left', $event)"
    ></div>
    <div class="timeline-transition-overlay__label">
      {{ transitionLabel }}
    </div>
    <div class="clip-content timeline-transition-overlay__content">
      <div class="timeline-transition-overlay__stripe"></div>
    </div>
    <div
      v-if="isSelected"
      class="resize-handle resize-handle-right"
      @mousedown.stop="handleResizeStart('right', $event)"
    ></div>
  </div>
</template>

<script setup lang="ts">
import { computed, onUnmounted, ref } from 'vue'
import { effectTemplateRegistry } from '@/core/effect-template/EffectTemplateRegistry'
import { useUnifiedStore } from '@/core/unifiedStore'
import { useAppI18n } from '@/core/composables/useI18n'
import { IconComponents } from '@/constants/iconComponents'
import { DEFAULT_TRACK_PADDING } from '@/constants/TrackConstants'
import { THUMBNAIL_CONSTANTS } from '@/constants/ThumbnailConstants'
import type { TimelineTransitionOverlayViewModel } from '@/core/timelineitem/transitionOverlay'
import type { TimelineSelectionId } from '@/core/types/timelineSelection'
import { alignFramesToFrame } from '@/core/utils/timeUtils'
import { normalizeClipTransitionOutConfig } from '@/core/timelineitem/transition'
import { TimelineItemQueries } from '@/core/timelineitem/queries'
import type { SnapPoint } from '@/types/snap'
import type { SnapResultState } from '@/core/composables/useTimelineSnap'

interface Props {
  overlay: TimelineTransitionOverlayViewModel
  timelineWidth: number
  trackHeight: number
}

const props = defineProps<Props>()
const emit = defineEmits<{
  select: [event: MouseEvent, selectionId: TimelineSelectionId]
  contextMenu: [event: MouseEvent, sourceItemId: string]
  updateSnapResult: [snapResult: SnapResultState | null]
}>()

const unifiedStore = useUnifiedStore()
const { t } = useAppI18n()
const isResizing = ref(false)
const resizeDirection = ref<'left' | 'right' | null>(null)
const resizeStartX = ref(0)
const resizeStartDurationFrames = ref(0)
const tempDurationFrames = ref(0)
const MIN_TRANSITION_DURATION_FRAMES = 2

const overlayClasses = computed(() => [
  'unified-timeline-clip',
  'unified-timeline-transition-overlay',
  {
    selected: isSelected.value,
    resizing: isResizing.value,
  },
])

const isSelected = computed(() =>
  unifiedStore.isTimelineSelectionSelected(props.overlay.selectionId),
)

const sourceTimelineItem = computed(
  () => unifiedStore.getTimelineItem(props.overlay.sourceItemId) ?? null,
)

const transitionConfig = computed(() =>
  normalizeClipTransitionOutConfig(TimelineItemQueries.getTransition(sourceTimelineItem.value)),
)

const transitionLabel = computed(() => {
  const transitionConfig = TimelineItemQueries.getTransition(sourceTimelineItem.value)
  const effectPackageId = transitionConfig?.effectPackageId
  if (!effectPackageId) {
    return t('properties.transition.title')
  }

  return effectTemplateRegistry.getPackageState(effectPackageId)?.meta?.name.zh
    || transitionConfig?.packagePayload?.manifestSnapshot.name.zh
    || t('properties.transition.title')
})

const hasPackageWarning = computed(() => {
  const effectPackageId = TimelineItemQueries.getTransition(sourceTimelineItem.value)?.effectPackageId
  if (!effectPackageId) {
    return false
  }
  return effectTemplateRegistry.getPackageState(effectPackageId)?.status !== 'ready'
})

const rightTimelineItem = computed(() => {
  const rightItemId = sourceTimelineItem.value?.runtime.transition?.rightItemId
  if (!rightItemId) return null
  return unifiedStore.getTimelineItem(rightItemId) ?? null
})

const currentDurationFrames = computed(() =>
  isResizing.value
    ? tempDurationFrames.value
    : clampResizeDurationFrames(transitionConfig.value.durationFrames),
)

const maxDurationFrames = computed(() => {
  const leftDurationFrames = sourceTimelineItem.value
    ? sourceTimelineItem.value.timeRange.timelineEndTime -
      sourceTimelineItem.value.timeRange.timelineStartTime
    : 2
  const rightDurationFrames = rightTimelineItem.value
    ? rightTimelineItem.value.timeRange.timelineEndTime -
      rightTimelineItem.value.timeRange.timelineStartTime
    : leftDurationFrames

  return Math.max(
    MIN_TRANSITION_DURATION_FRAMES,
    Math.min(leftDurationFrames, rightDurationFrames) * 2,
  )
})

function clampResizeDurationFrames(durationFrames: number): number {
  return Math.min(
    maxDurationFrames.value,
    Math.max(MIN_TRANSITION_DURATION_FRAMES, Math.round(durationFrames)),
  )
}

function resolveDisplayRange(durationFrames: number) {
  const leftHalfFrames = Math.floor(durationFrames / 2)
  const rightHalfFrames = durationFrames - leftHalfFrames
  return {
    startFrame: Math.max(0, props.overlay.seamFrame - leftHalfFrames),
    endFrame: props.overlay.seamFrame + rightHalfFrames,
  }
}

const overlayStyles = computed(() => {
  const displayRange = resolveDisplayRange(currentDurationFrames.value)
  const left = unifiedStore.frameToPixel(displayRange.startFrame, props.timelineWidth)
  const right = unifiedStore.frameToPixel(displayRange.endFrame, props.timelineWidth)
  const overlayHeight = THUMBNAIL_CONSTANTS.HEIGHT
  const clipHeight = Math.max(props.trackHeight - DEFAULT_TRACK_PADDING * 2, 0)
  // Match VideoContent's actual vertical layout:
  // 1. center the thumbnail strip inside the clip body
  // 2. apply the additional thumbnail top offset
  const thumbnailTopInTrack = Math.max(
    DEFAULT_TRACK_PADDING +
      (clipHeight - overlayHeight) / 2 +
      THUMBNAIL_CONSTANTS.TOP_OFFSET,
    0,
  )

  return {
    height: `${overlayHeight}px`,
    top: `${thumbnailTopInTrack}px`,
    left: `${left}px`,
    width: `${Math.max(right - left, 20)}px`,
  }
})

function handleSelect(event: MouseEvent) {
  emit('select', event, props.overlay.selectionId)
}

function handleContextMenu(event: MouseEvent) {
  emit('contextMenu', event, props.overlay.sourceItemId)
}

function handleResizeStart(direction: 'left' | 'right', event: MouseEvent) {
  unifiedStore.pause()
  isResizing.value = true
  resizeDirection.value = direction
  resizeStartX.value = event.clientX
  resizeStartDurationFrames.value = clampResizeDurationFrames(transitionConfig.value.durationFrames)
  tempDurationFrames.value = resizeStartDurationFrames.value

  document.addEventListener('mousemove', handleResize)
  document.addEventListener('mouseup', stopResize)
  event.preventDefault()
}

function handleResize(event: MouseEvent) {
  if (!isResizing.value || !resizeDirection.value) return

  const deltaX = event.clientX - resizeStartX.value
  const initialDisplayRange = resolveDisplayRange(resizeStartDurationFrames.value)
  const parity = resizeStartDurationFrames.value % 2
  let nextDurationFrames = resizeStartDurationFrames.value

  if (resizeDirection.value === 'left') {
    const currentLeftPixel = unifiedStore.frameToPixel(initialDisplayRange.startFrame, props.timelineWidth)
    const newLeftPixel = currentLeftPixel + deltaX
    let newLeftFrame = alignFramesToFrame(
      unifiedStore.pixelToFrame(newLeftPixel, props.timelineWidth),
    )
    const leftSnapResult = resolveTransitionBoundarySnap(newLeftFrame)
    if (leftSnapResult) {
      newLeftFrame = leftSnapResult.frame
      emit('updateSnapResult', leftSnapResult.indicator)
    } else {
      emit('updateSnapResult', null)
    }
    const desiredLeftHalfFrames = Math.max(1, props.overlay.seamFrame - newLeftFrame)
    nextDurationFrames = Math.max(MIN_TRANSITION_DURATION_FRAMES, desiredLeftHalfFrames * 2 + parity)
  } else {
    const currentRightPixel = unifiedStore.frameToPixel(initialDisplayRange.endFrame, props.timelineWidth)
    const newRightPixel = currentRightPixel + deltaX
    let newRightFrame = alignFramesToFrame(
      unifiedStore.pixelToFrame(newRightPixel, props.timelineWidth),
    )
    const rightSnapResult = resolveTransitionBoundarySnap(newRightFrame)
    if (rightSnapResult) {
      newRightFrame = rightSnapResult.frame
      emit('updateSnapResult', rightSnapResult.indicator)
    } else {
      emit('updateSnapResult', null)
    }
    const desiredRightHalfFrames = Math.max(1, newRightFrame - props.overlay.seamFrame)
    nextDurationFrames = Math.max(MIN_TRANSITION_DURATION_FRAMES, desiredRightHalfFrames * 2 - parity)
  }

  tempDurationFrames.value = clampResizeDurationFrames(nextDurationFrames)
}

async function stopResize() {
  if (!isResizing.value) return

  document.removeEventListener('mousemove', handleResize)
  document.removeEventListener('mouseup', stopResize)

  const nextDurationFrames = clampResizeDurationFrames(tempDurationFrames.value)
  const currentDurationFrames = transitionConfig.value.durationFrames
  isResizing.value = false
  resizeDirection.value = null
  emit('updateSnapResult', null)

  if (!sourceTimelineItem.value || nextDurationFrames === currentDurationFrames) {
    return
  }

  await unifiedStore.updateTransitionConfigWithHistory(sourceTimelineItem.value.id, {
    ...transitionConfig.value,
    durationFrames: nextDurationFrames,
  })
}

onUnmounted(() => {
  document.removeEventListener('mousemove', handleResize)
  document.removeEventListener('mouseup', stopResize)
})

function resolveTransitionBoundarySnap(frame: number): {
  frame: number
  indicator: SnapResultState
} | null {
  const snapTargets = unifiedStore.collectSnapTargets({
    includeClipBoundaries: unifiedStore.snapConfig.clipBoundaries,
    includePlayhead: unifiedStore.snapConfig.playhead,
    includeTimelineStart: unifiedStore.snapConfig.timelineStart,
    includeKeyframes: unifiedStore.snapConfig.keyframes,
  })

  const filteredTargets = snapTargets.filter((target) => {
    if (target.frame === props.overlay.seamFrame) {
      return false
    }

    if (
      (target.type === 'transition-start' || target.type === 'transition-end') &&
      target.clipId === props.overlay.sourceItemId
    ) {
      return false
    }

    return true
  })

  const pixelsPerFrame =
    (props.timelineWidth * unifiedStore.zoomLevel) /
    Math.max(1, unifiedStore.totalDurationFrames)
  const frameThreshold = unifiedStore.snapConfig.threshold / Math.max(pixelsPerFrame, 0.0001)

  let bestTarget: SnapPoint | null = null
  let bestDistance = Infinity

  for (const target of filteredTargets) {
    const distance = Math.abs(frame - target.frame)
    if (distance < bestDistance && distance <= frameThreshold) {
      bestDistance = distance
      bestTarget = target
    }
  }

  if (!bestTarget) {
    return null
  }

  return {
    frame: bestTarget.frame,
    indicator: {
      snapped: true,
      frame: bestTarget.frame,
      snapPoint: bestTarget,
      distance: bestDistance,
    },
  }
}
</script>

<style scoped>
.timeline-transition-overlay__label {
  position: absolute;
  inset: 0;
  z-index: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 0 8px;
  font-size: 12px;
  font-weight: 600;
  line-height: 1;
  color: white;
  text-align: center;
  text-shadow: 0 1px 2px rgba(0, 0, 0, 0.8);
  pointer-events: none;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.timeline-transition-overlay__warning {
  position: absolute;
  top: 4px;
  right: 4px;
  z-index: 3;
  width: 18px;
  height: 18px;
  border-radius: 999px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(255, 184, 77, 0.95);
  color: #2f1900;
}

.timeline-transition-overlay__content {
  display: flex;
  align-items: stretch;
  justify-content: stretch;
  opacity: 0.95;
}

.timeline-transition-overlay__stripe {
  width: 100%;
  height: 100%;
  background:
    linear-gradient(135deg, rgba(255, 255, 255, 0.12), rgba(255, 255, 255, 0.03)),
    repeating-linear-gradient(
      120deg,
      rgba(255, 255, 255, 0.3) 0px,
      rgba(255, 255, 255, 0.3) 1px,
      rgba(255, 255, 255, 0.1) 1px,
      rgba(255, 255, 255, 0.1) 2px
    );
}
</style>
