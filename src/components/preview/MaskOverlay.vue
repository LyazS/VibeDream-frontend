<template>
  <div v-if="shouldShowOverlay" class="mask-overlay-container">
    <div
      v-if="primaryGuide"
      class="mask-overlay-body"
      :style="primaryGuideStyle"
      :class="{ 'is-dragging': Boolean(activeSession) }"
      @mousedown.stop="handleBodyMouseDown"
      @click.stop
    />

    <div
      v-for="guide in guides"
      :key="guide.id"
      class="mask-guide"
      :class="`variant-${guide.variant}`"
      :style="getGuideStyle(guide)"
    />

    <div
      v-for="line in handleConnectorLines"
      :key="line.id"
      class="mask-handle-line"
      :class="`variant-${line.variant}`"
      :style="getHandleLineStyle(line)"
    />

    <div
      v-for="handle in handles"
      :key="handle.id"
      class="mask-handle"
      :class="[`variant-${handle.styleVariant}`, { active: activeHandleId === handle.id }]"
      :style="getHandleStyle(handle)"
      @mousedown.stop="handleHandleMouseDown($event, handle)"
    >
      <svg
        v-if="handle.styleVariant === 'rotation'"
        width="12"
        height="12"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="2"
      >
        <path d="M21.5 2v6h-6M2.5 22v-6h6M2 11.5a10 10 0 0 1 18.8-4.3M22 12.5a10 10 0 0 1-18.8 4.2"/>
      </svg>
      <svg
        v-else-if="handle.styleVariant === 'feather'"
        width="12"
        height="12"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="2"
        stroke-linecap="round"
        stroke-linejoin="round"
      >
        <path d="M19 6c-5 1-8.5 4.5-9.5 9.5" />
        <path d="M14.5 4.5c-6.5 2-10 5.5-12 12" />
        <path d="M9 15c-1.3 1.3-3.2 2-5 2c0-1.8.7-3.7 2-5" />
      </svg>
      <svg
        v-else-if="handle.styleVariant === 'intensity'"
        width="12"
        height="12"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="2"
        stroke-linecap="round"
        stroke-linejoin="round"
      >
        <path d="M4 16c2.2-2.7 4.9-4 8-4s5.8 1.3 8 4" />
        <path d="M4 11c2.2-2 4.9-3 8-3s5.8 1 8 3" />
        <path d="M12 6v12" />
      </svg>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onUnmounted, ref, watch } from 'vue'
import { useUnifiedStore } from '@/core/unifiedStore'
import { TimelineItemQueries } from '@/core/timelineitem/queries'
import { useUnifiedMaskKeyframeControls } from '@/core/composables'
import { ellipseMaskAdapter } from '@/core/preview/maskOverlay/ellipseMaskAdapter'
import { linearMaskAdapter } from '@/core/preview/maskOverlay/linearMaskAdapter'
import { mirrorMaskAdapter } from '@/core/preview/maskOverlay/mirrorMaskAdapter'
import { rectangleMaskAdapter, defaultMaskAdapter } from '@/core/preview/maskOverlay/rectangleMaskAdapter'
import type {
  MaskGuideDescriptor,
  MaskHandleDescriptor,
  MaskInteractionSession,
  MaskOverlayAdapter,
  MaskOverlayContext,
  PreviewTransformState,
} from '@/core/preview/maskOverlay/types'
import { clientPointToCanvasPoint } from '@/core/preview/maskOverlay/types'

interface Props {
  selectedTimelineItemId: string | null
  isMultiSelectMode: boolean
  containerElement: HTMLElement | null
  canvasResolution: { width: number; height: number }
  canvasDisplaySize: { width: number; height: number }
  containerSize: { width: number; height: number }
  currentFrame: number
  previewTransform: PreviewTransformState
}

const props = defineProps<Props>()
const emit = defineEmits<{
  (e: 'suppress-click'): void
}>()
const unifiedStore = useUnifiedStore()

const selectedItem = computed(() => {
  if (!props.selectedTimelineItemId) return null
  return unifiedStore.getTimelineItem(props.selectedTimelineItemId) ?? null
})

const {
  maskConfig,
  itemLocalSize,
  beginMaskInteraction,
  applyMaskDeferredPatch,
  commitMaskInteraction,
  cancelMaskInteraction,
} = useUnifiedMaskKeyframeControls({
  selectedTimelineItem: selectedItem,
  currentFrame: computed(() => props.currentFrame),
})

const shouldShowOverlay = computed(() => {
  if (props.isMultiSelectMode || unifiedStore.activePropertyTab !== 'mask') return false
  if (!selectedItem.value) return false
  return (
    TimelineItemQueries.hasVisualProperties(selectedItem.value) &&
    Boolean(TimelineItemQueries.getMask(selectedItem.value))
  )
})

const overlayContext = computed<MaskOverlayContext | null>(() => {
  if (
    !shouldShowOverlay.value ||
    !selectedItem.value ||
    !TimelineItemQueries.hasVisualProperties(selectedItem.value)
  ) {
    return null
  }
  return {
    item: selectedItem.value,
    maskConfig: maskConfig.value,
    visualConfig: TimelineItemQueries.getRenderConfig(selectedItem.value).visual,
    itemLocalSize: itemLocalSize.value,
    canvasResolution: props.canvasResolution,
    canvasDisplaySize: props.canvasDisplaySize,
    containerSize: props.containerSize,
    previewTransform: props.previewTransform,
  }
})

const adapterMap: Partial<Record<string, MaskOverlayAdapter>> = {
  rectangle: rectangleMaskAdapter,
  ellipse: ellipseMaskAdapter,
  linear: linearMaskAdapter,
  mirror: mirrorMaskAdapter,
}

const adapter = computed<MaskOverlayAdapter>(() => {
  const context = overlayContext.value
  if (!context) return defaultMaskAdapter
  return adapterMap[context.maskConfig.type] ?? defaultMaskAdapter
})

const guides = computed(() => {
  const context = overlayContext.value
  return context ? adapter.value.getGuides(context) : []
})

const handles = computed(() => {
  const context = overlayContext.value
  return context ? adapter.value.getHandles(context) : []
})

const primaryGuide = computed(() => guides.value.find((guide) => guide.variant === 'primary') ?? null)
const featherGuide = computed(() => guides.value.find((guide) => guide.variant === 'feather') ?? null)
const primaryGuideStyle = computed(() => (primaryGuide.value ? getGuideStyle(primaryGuide.value) : {}))
const outerHandles = computed(() =>
  handles.value.filter((handle) =>
    handle.styleVariant === 'rotation' ||
    handle.styleVariant === 'feather' ||
    handle.styleVariant === 'intensity',
  ),
)
const handleConnectorLines = computed(() => {
  return outerHandles.value.flatMap((handle) => {
    const anchor = getHandleAnchorPoint(handle)
    if (!anchor) return []

    const dx = handle.x - anchor.x
    const dy = handle.y - anchor.y
    return [{
      id: `${handle.id}-line`,
      variant: handle.styleVariant,
      x: anchor.x,
      y: anchor.y,
      width: Math.hypot(dx, dy),
      rotation: Math.atan2(dy, dx),
    }]
  })
})

const activeSession = ref<MaskInteractionSession | null>(null)
const activeHandleId = ref<string | null>(null)
const DRAGGING_CLASS = 'mask-overlay--dragging'

function clearWindowListeners() {
  window.removeEventListener('mousemove', handleWindowMouseMove)
  window.removeEventListener('mouseup', handleWindowMouseUp)
}

function resetInteractionState() {
  clearWindowListeners()
  setDraggingUserSelect(false)
  activeSession.value = null
  activeHandleId.value = null
}

function setDraggingUserSelect(disabled: boolean) {
  document.documentElement.classList.toggle(DRAGGING_CLASS, disabled)
  document.body.classList.toggle(DRAGGING_CLASS, disabled)
}

function getGuideStyle(guide: MaskGuideDescriptor) {
  return {
    left: `${guide.left}px`,
    top: `${guide.top}px`,
    width: `${guide.width}px`,
    height: `${guide.height}px`,
    transform: `rotate(${guide.rotation}rad)`,
  }
}

function getHandleStyle(handle: MaskHandleDescriptor) {
  return {
    left: `${handle.x}px`,
    top: `${handle.y}px`,
    cursor: adapter.value.getCursor(handle),
  }
}

function getRotatedPoint(
  centerX: number,
  centerY: number,
  localX: number,
  localY: number,
  rotation: number,
) {
  const cos = Math.cos(rotation)
  const sin = Math.sin(rotation)
  return {
    x: centerX + localX * cos - localY * sin,
    y: centerY + localX * sin + localY * cos,
  }
}

function getHandleAnchorPoint(handle: MaskHandleDescriptor) {
  if (handle.anchorX !== undefined && handle.anchorY !== undefined) {
    return {
      x: handle.anchorX,
      y: handle.anchorY,
    }
  }

  const guide = handle.styleVariant === 'rotation' ? primaryGuide.value : featherGuide.value
  if (!guide) return null

  const centerX = guide.left + guide.width * 0.5
  const centerY = guide.top + guide.height * 0.5

  if (handle.styleVariant === 'rotation') {
    return getRotatedPoint(centerX, centerY, 0, -guide.height * 0.5, guide.rotation)
  }

  if (handle.styleVariant === 'feather') {
    return getRotatedPoint(centerX, centerY, 0, guide.height * 0.5, guide.rotation)
  }

  if (handle.styleVariant === 'intensity') {
    return getRotatedPoint(centerX, centerY, guide.width * 0.5, 0, guide.rotation)
  }

  return null
}

function getHandleLineStyle(line: {
  x: number
  y: number
  width: number
  rotation: number
}) {
  return {
    left: `${line.x}px`,
    top: `${line.y}px`,
    width: `${line.width}px`,
    transform: `rotate(${line.rotation}rad)`,
  }
}

function beginInteraction(event: MouseEvent, handle: MaskHandleDescriptor) {
  event.preventDefault()
  const context = overlayContext.value
  const container = props.containerElement
  if (!context || !(container instanceof HTMLElement)) return

  const startCanvasPoint = clientPointToCanvasPoint(
    event.clientX,
    event.clientY,
    container.getBoundingClientRect(),
    context,
  )

  const session = adapter.value.beginInteraction(context, handle, startCanvasPoint)
  if (!session) return

  beginMaskInteraction()
  activeSession.value = session
  activeHandleId.value = handle.id
  setDraggingUserSelect(true)

  window.addEventListener('mousemove', handleWindowMouseMove)
  window.addEventListener('mouseup', handleWindowMouseUp)
}

function handleBodyMouseDown(event: MouseEvent) {
  const guide = primaryGuide.value
  const moveHandle: MaskHandleDescriptor = {
    id: 'move-body',
    kind: 'move',
    position: 'body',
    axis: 'xy',
    visible: true,
    styleVariant: 'custom',
    x: 0,
    y: 0,
    anchorX: guide ? guide.left + guide.width * 0.5 : undefined,
    anchorY: guide ? guide.top + guide.height * 0.5 : undefined,
    cursor: 'move',
  }
  beginInteraction(event, moveHandle)
}

function handleHandleMouseDown(event: MouseEvent, handle: MaskHandleDescriptor) {
  beginInteraction(event, handle)
}

function handleWindowMouseMove(event: MouseEvent) {
  event.preventDefault()
  const context = overlayContext.value
  const session = activeSession.value
  const container = props.containerElement
  if (!context || !session || !(container instanceof HTMLElement)) return

  const point = clientPointToCanvasPoint(
    event.clientX,
    event.clientY,
    container.getBoundingClientRect(),
    context,
  )
  const patch = adapter.value.updateInteraction(context, session, point)
  applyMaskDeferredPatch(patch)
}

async function handleWindowMouseUp() {
  if (!activeSession.value) return

  clearWindowListeners()
  setDraggingUserSelect(false)
  emit('suppress-click')

  activeSession.value = null
  activeHandleId.value = null
  await commitMaskInteraction()
}

watch(shouldShowOverlay, (visible) => {
  if (visible) return
  resetInteractionState()
  cancelMaskInteraction()
})

watch(() => props.selectedTimelineItemId, (nextId, prevId) => {
  if (!activeSession.value || nextId === prevId) return
  resetInteractionState()
  cancelMaskInteraction()
})

onUnmounted(() => {
  resetInteractionState()
  cancelMaskInteraction()
})
</script>

<style scoped>
.mask-overlay-container {
  position: absolute;
  inset: 0;
  pointer-events: none;
  z-index: 12;
}

.mask-overlay-body,
.mask-guide,
.mask-handle,
.mask-handle-line {
  position: absolute;
  box-sizing: border-box;
}

.mask-overlay-body,
.mask-guide {
  transform-origin: center center;
}

.mask-overlay-body {
  border: 2px solid rgba(255, 255, 255, 0.95);
  pointer-events: auto;
  cursor: move;
}

.mask-overlay-body.is-dragging {
  border-color: #5ba6ff;
}

.mask-guide {
  pointer-events: none;
}

.mask-handle-line {
  height: 2px;
  transform-origin: left center;
  pointer-events: none;
}

.mask-guide.variant-primary {
  border: 1px solid rgba(255, 255, 255, 0.65);
}

.mask-guide.variant-feather {
  border: 1px dashed rgba(91, 166, 255, 0.9);
}

.mask-handle-line.variant-rotation,
.mask-handle-line.variant-feather,
.mask-handle-line.variant-intensity {
  background: rgba(255, 255, 255, 0.92);
}

.mask-handle {
  width: 12px;
  height: 12px;
  transform: translate(-50%, -50%);
  border: 1px solid #ffffff;
  background: #ffffff;
  pointer-events: auto;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #425066;
}

.mask-handle.variant-corner {
  border-radius: 2px;
}

.mask-handle.variant-edge,
.mask-handle.variant-feather,
.mask-handle.variant-intensity,
.mask-handle.variant-rotation {
  border-radius: 999px;
}

.mask-handle.variant-rotation {
  width: 18px;
  height: 18px;
}

.mask-handle.variant-feather {
  background: #5ba6ff;
  color: #ffffff;
}

.mask-handle.variant-intensity {
  background: #f5b84a;
  color: #ffffff;
}

.mask-handle.active {
  box-shadow: 0 0 0 2px rgba(91, 166, 255, 0.45);
}

.mask-handle svg {
  display: block;
}
</style>

<style>
.mask-overlay--dragging,
.mask-overlay--dragging * {
  user-select: none !important;
  -webkit-user-select: none !important;
}
</style>
