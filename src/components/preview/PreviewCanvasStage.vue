<template>
  <div
    ref="rendererContainerRef"
    class="renderer-container"
    :class="{ 'is-panning': panState.isPanning }"
    @mousedown.capture="handleStageMouseDown"
    @auxclick="handleAuxClick"
    @contextmenu="handleContextMenu"
    @click="handleCanvasClick"
  >
    <div class="preview-stage-content" :style="stageTransformStyle">
      <BunnyRender ref="bunnyRenderRef" />
      <MaskOverlay
        v-if="showMaskOverlay"
        :selected-timeline-item-id="selectedClipTimelineItemId"
        :is-multi-select-mode="isMultiSelectMode"
        :container-element="rendererContainerRef"
        :canvas-resolution="canvasResolution"
        :canvas-display-size="canvasDisplaySize"
        :container-size="containerSize"
        :current-frame="currentFrame"
        :preview-transform="previewTransform"
        @suppress-click="suppressCanvasClickOnce"
      />
      <SelectionIndicator
        v-else
        :selected-timeline-item-id="selectedClipTimelineItemId"
        :is-multi-select-mode="isMultiSelectMode"
        :canvas-resolution="canvasResolution"
        :canvas-display-size="canvasDisplaySize"
        :container-size="containerSize"
        :current-frame="currentFrame"
        @drag-start="handleDragStart"
        @drag-move="handleDragMove"
        @drag-end="handleDragEnd"
        @scale-start="handleScaleStart"
        @rotate-start="handleRotateStart"
      />
    </div>

    <HoverButton
      v-if="isPreviewTransformed"
      class="preview-reset-btn"
      variant="small"
      title="还原预览缩放"
      @click="handleResetButtonClick"
    >
      <template #icon>
        <component :is="IconComponents.REFRESH" size="16px" />
      </template>
    </HoverButton>

    <ContextMenu v-model:show="showContextMenu" :options="contextMenuOptions">
      <template v-for="(item, index) in contextMenuItems" :key="index">
        <ContextMenuSeparator v-if="'type' in item && item.type === 'separator'" />
        <ContextMenuItem
          v-else-if="'label' in item && 'onClick' in item"
          :label="item.label"
          :disabled="item.disabled"
          @click="item.onClick"
        >
          <template #icon>
            <component :is="item.icon" size="16px" />
          </template>
        </ContextMenuItem>
      </template>
    </ContextMenu>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted, nextTick } from 'vue'
import BunnyRender from '@/components/panels/BunnyRender.vue'
import SelectionIndicator from '@/components/preview/SelectionIndicator.vue'
import MaskOverlay from '@/components/preview/MaskOverlay.vue'
import HoverButton from '@/components/base/HoverButton.vue'
import { IconComponents } from '@/constants/iconComponents'
import { useUnifiedStore } from '@/core/unifiedStore'
import { useAppI18n } from '@/core/composables/useI18n'
import {
  ContextMenu,
  ContextMenuItem,
  ContextMenuSeparator,
} from '@imengyu/vue3-context-menu'
import {
  domToCanvasCoordinates,
  isPointInRotatedBoundingBox,
  domDeltaToCanvasDelta,
} from '@/core/utils/canvasClickUtils'
import {
  getVisibleTimelineItems,
  sortTimelineItemsByTrackIndex,
} from '@/core/utils/timelineVisibilityUtils'
import { TimelineItemQueries } from '@/core/timelineitem/queries'
import { useUnifiedKeyframeTransformControls } from '@/core/composables/useKeyframeTransformControls'
import { calculateScaledSize, calculateRotationAngle } from '@/core/utils/transformMath'
import { buildClipSelectionId } from '@/core/types/timelineSelection'

const unifiedStore = useUnifiedStore()
const { t } = useAppI18n()
const MIN_PREVIEW_ZOOM = 0.25
const MAX_PREVIEW_ZOOM = 8

const rendererContainerRef = ref<HTMLElement | null>(null)
const containerSizeValue = ref({ width: 0, height: 0 })
const bunnyRenderRef = ref<InstanceType<typeof BunnyRender> | null>(null)
const previewZoom = ref(1)
const previewOffsetX = ref(0)
const previewOffsetY = ref(0)

const selectedClipTimelineItemId = computed(() => unifiedStore.selectedClipTimelineItemId)
const isMultiSelectMode = computed(() => unifiedStore.isTimelineSelectionMultiSelectMode)
const canvasResolution = computed(() => unifiedStore.videoResolution)
const canvasDisplaySize = computed(
  () => bunnyRenderRef.value?.canvasDisplaySize || { width: 0, height: 0 },
)
const containerSize = computed(() => containerSizeValue.value)
const currentFrame = computed(() => unifiedStore.currentFrame)
const stageCenter = computed(() => ({
  x: containerSize.value.width / 2,
  y: containerSize.value.height / 2,
}))
const isPreviewTransformed = computed(
  () => previewZoom.value !== 1 || previewOffsetX.value !== 0 || previewOffsetY.value !== 0,
)
const stageTransformStyle = computed(() => ({
  transform: `translate(${previewOffsetX.value}px, ${previewOffsetY.value}px) scale(${previewZoom.value})`,
  transformOrigin: 'center center',
}))
const previewTransform = computed(() => ({
  zoom: previewZoom.value,
  offsetX: previewOffsetX.value,
  offsetY: previewOffsetY.value,
}))
const showMaskOverlay = computed(
  () => {
    if (
      unifiedStore.activePropertyTab !== 'mask' ||
      selectedClipTimelineItemId.value === null ||
      isMultiSelectMode.value ||
      !selectedItem.value ||
      !TimelineItemQueries.hasVisualProperties(selectedItem.value)
    ) {
      return false
    }

    return true
  },
)

const selectedItem = computed(() => {
  if (!selectedClipTimelineItemId.value) return null
  return unifiedStore.getTimelineItem(selectedClipTimelineItemId.value) ?? null
})

const {
  setTransformPositionDeferred,
  setTransformSizeDeferred,
  setTransformRotationDeferred,
  commitDeferredUpdates,
} = useUnifiedKeyframeTransformControls({
  selectedTimelineItem: selectedItem,
  currentFrame,
})

const dragState = ref({
  isDragging: false,
  startX: 0,
  startY: 0,
  initialCanvasX: 0,
  initialCanvasY: 0,
  hasMoved: false,
})

const scaleState = ref({
  isScaling: false,
  handleType: null as 'corner' | 'edge' | null,
  handlePosition: null as string | null,
  isProportional: false,
  startX: 0,
  startY: 0,
  initialWidth: 0,
  initialHeight: 0,
  initialX: 0,
  initialY: 0,
  initialRotation: 0,
  hasMoved: false,
})

const rotationState = ref({
  isRotating: false,
  startX: 0,
  startY: 0,
  initialRotation: 0,
  centerPoint: null as { x: number; y: number } | null,
  hasMoved: false,
})
const suppressNextCanvasClick = ref(false)
let suppressNextCanvasClickTimer: number | null = null

const panState = ref({
  isPanning: false,
  startX: 0,
  startY: 0,
  initialOffsetX: 0,
  initialOffsetY: 0,
  hasMoved: false,
})

const showContextMenu = ref(false)
const contextMenuOptions = ref({
  x: 0,
  y: 0,
  theme: 'mac dark',
  zIndex: 1000,
})

type MenuItem =
  | {
      label: string
      icon: any
      onClick?: () => void
      disabled?: boolean
    }
  | {
      type: 'separator'
    }

const contextMenuItems = computed((): MenuItem[] => {
  return [
    {
      label: t('editor.preview.downloadCurrentFrame'),
      icon: IconComponents.IMAGE_SMALL,
      onClick: captureCanvasFrame,
    },
  ]
})

const updateContainerSize = () => {
  if (!rendererContainerRef.value) return
  const rect = rendererContainerRef.value.getBoundingClientRect()
  containerSizeValue.value = { width: rect.width, height: rect.height }
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value))
}

function screenPointToStagePoint(domX: number, domY: number) {
  return {
    x: stageCenter.value.x + (domX - stageCenter.value.x - previewOffsetX.value) / previewZoom.value,
    y: stageCenter.value.y + (domY - stageCenter.value.y - previewOffsetY.value) / previewZoom.value,
  }
}

function screenDeltaToStageDelta(deltaX: number, deltaY: number) {
  return {
    x: deltaX / previewZoom.value,
    y: deltaY / previewZoom.value,
  }
}

function resetPreviewTransform() {
  previewZoom.value = 1
  previewOffsetX.value = 0
  previewOffsetY.value = 0
}

function handleResetButtonClick(event: MouseEvent) {
  event.stopPropagation()
  resetPreviewTransform()
}

function handlePreviewWheel(event: WheelEvent) {
  if (!event.altKey) return
  if (
    dragState.value.isDragging ||
    scaleState.value.isScaling ||
    rotationState.value.isRotating ||
    panState.value.isPanning
  ) {
    return
  }

  event.preventDefault()

  const rect = rendererContainerRef.value?.getBoundingClientRect()
  if (!rect) return

  const mouseX = event.clientX - rect.left
  const mouseY = event.clientY - rect.top
  const stagePoint = screenPointToStagePoint(mouseX, mouseY)
  const nextZoom = clamp(
    previewZoom.value * Math.exp(-event.deltaY * 0.0015),
    MIN_PREVIEW_ZOOM,
    MAX_PREVIEW_ZOOM,
  )

  previewZoom.value = nextZoom
  previewOffsetX.value =
    mouseX - stageCenter.value.x - nextZoom * (stagePoint.x - stageCenter.value.x)
  previewOffsetY.value =
    mouseY - stageCenter.value.y - nextZoom * (stagePoint.y - stageCenter.value.y)
}

function handleStageMouseDown(event: MouseEvent) {
  if (event.button !== 1) return
  if (dragState.value.isDragging || scaleState.value.isScaling || rotationState.value.isRotating) return

  event.preventDefault()

  panState.value = {
    isPanning: true,
    startX: event.clientX,
    startY: event.clientY,
    initialOffsetX: previewOffsetX.value,
    initialOffsetY: previewOffsetY.value,
    hasMoved: false,
  }

  window.addEventListener('mousemove', handleGlobalPanMove)
  window.addEventListener('mouseup', handleGlobalPanEnd)
}

function handlePanMove(event: MouseEvent) {
  if (!panState.value.isPanning) return

  const deltaX = event.clientX - panState.value.startX
  const deltaY = event.clientY - panState.value.startY

  if (deltaX !== 0 || deltaY !== 0) {
    panState.value.hasMoved = true
  }

  previewOffsetX.value = panState.value.initialOffsetX + deltaX
  previewOffsetY.value = panState.value.initialOffsetY + deltaY
}

function handleGlobalPanMove(event: MouseEvent) {
  handlePanMove(event)
}

function endPan() {
  panState.value.isPanning = false
  panState.value.hasMoved = false
  window.removeEventListener('mousemove', handleGlobalPanMove)
  window.removeEventListener('mouseup', handleGlobalPanEnd)
}

function handleGlobalPanEnd(_event: MouseEvent) {
  if (!panState.value.isPanning) return
  endPan()
}

function handleAuxClick(event: MouseEvent) {
  if (event.button === 1) {
    event.preventDefault()
  }
}

function handleDragStart(event: MouseEvent) {
  if (!selectedClipTimelineItemId.value) return

  const item = selectedItem.value
  if (!item || !TimelineItemQueries.hasVisualProperties(item)) return

  const config = TimelineItemQueries.getRenderConfig(item)

  dragState.value = {
    isDragging: true,
    startX: event.clientX,
    startY: event.clientY,
    initialCanvasX: config.x,
    initialCanvasY: config.y,
    hasMoved: false,
  }

  window.addEventListener('mousemove', handleGlobalMouseMove)
  window.addEventListener('mouseup', handleGlobalMouseUp)
}

function handleDragMove(event: MouseEvent) {
  if (!dragState.value.isDragging) return

  dragState.value.hasMoved = true

  const screenDelta = screenDeltaToStageDelta(
    event.clientX - dragState.value.startX,
    event.clientY - dragState.value.startY,
  )

  const canvasDelta = domDeltaToCanvasDelta(
    screenDelta.x,
    screenDelta.y,
    canvasDisplaySize.value,
    canvasResolution.value,
  )

  const newCanvasX = dragState.value.initialCanvasX + canvasDelta.x
  const newCanvasY = dragState.value.initialCanvasY + canvasDelta.y

  setTransformPositionDeferred(newCanvasX, newCanvasY)
}

async function handleDragEnd(_event: MouseEvent) {
  if (!dragState.value.isDragging) return

  await commitDeferredUpdates()
  dragState.value.isDragging = false

  window.removeEventListener('mousemove', handleGlobalMouseMove)
  window.removeEventListener('mouseup', handleGlobalMouseUp)
}

function handleGlobalMouseMove(event: MouseEvent) {
  handleDragMove(event)
}

async function handleGlobalMouseUp(event: MouseEvent) {
  await handleDragEnd(event)
}

function handleScaleStart(event: any) {
  if (!selectedClipTimelineItemId.value) return

  const item = selectedItem.value
  if (!item || !TimelineItemQueries.hasVisualProperties(item)) return

  const config = TimelineItemQueries.getRenderConfig(item)

  scaleState.value = {
    isScaling: true,
    handleType: event.handleType,
    handlePosition: event.handlePosition,
    isProportional: event.isProportional,
    startX: event.clientX,
    startY: event.clientY,
    initialWidth: config.width,
    initialHeight: config.height,
    initialX: config.x,
    initialY: config.y,
    initialRotation: config.rotation,
    hasMoved: false,
  }

  window.addEventListener('mousemove', handleGlobalScaleMove)
  window.addEventListener('mouseup', handleGlobalScaleEnd)
}

function handleScaleMove(event: MouseEvent) {
  if (!scaleState.value.isScaling) return

  scaleState.value.hasMoved = true

  const {
    handlePosition,
    isProportional,
    initialWidth,
    initialHeight,
    initialX,
    initialY,
    initialRotation,
  } = scaleState.value

  const stageDelta = screenDeltaToStageDelta(
    event.clientX - scaleState.value.startX,
    event.clientY - scaleState.value.startY,
  )

  const canvasDelta = domDeltaToCanvasDelta(
    stageDelta.x,
    stageDelta.y,
    canvasDisplaySize.value,
    canvasResolution.value,
  )

  const result = calculateScaledSize({
    initialWidth,
    initialHeight,
    initialX,
    initialY,
    deltaX: canvasDelta.x,
    deltaY: canvasDelta.y,
    handlePosition: handlePosition!,
    isProportional,
    elementRotation: initialRotation,
  })

  setTransformSizeDeferred(result.width, result.height, result.x, result.y)
}

async function handleScaleEnd(_event: MouseEvent) {
  if (!scaleState.value.isScaling) return

  await commitDeferredUpdates()
  scaleState.value.isScaling = false

  window.removeEventListener('mousemove', handleGlobalScaleMove)
  window.removeEventListener('mouseup', handleGlobalScaleEnd)
}

function handleGlobalScaleMove(event: MouseEvent) {
  handleScaleMove(event)
}

async function handleGlobalScaleEnd(event: MouseEvent) {
  await handleScaleEnd(event)
}

function handleRotateStart(event: any) {
  if (!selectedClipTimelineItemId.value) return

  const item = selectedItem.value
  if (!item || !TimelineItemQueries.hasVisualProperties(item)) return

  const config = TimelineItemQueries.getRenderConfig(item)

  rotationState.value = {
    isRotating: true,
    startX: event.clientX,
    startY: event.clientY,
    initialRotation: config.rotation,
    centerPoint: event.centerPoint,
    hasMoved: false,
  }

  window.addEventListener('mousemove', handleGlobalRotateMove)
  window.addEventListener('mouseup', handleGlobalRotateEnd)
}

function handleRotateMove(event: MouseEvent) {
  if (!rotationState.value.isRotating) return

  rotationState.value.hasMoved = true

  const rect = rendererContainerRef.value?.getBoundingClientRect()
  if (!rect) return

  const stagePoint = screenPointToStagePoint(event.clientX - rect.left, event.clientY - rect.top)

  const canvasPoint = domToCanvasCoordinates(
    stagePoint.x,
    stagePoint.y,
    canvasResolution.value,
    canvasDisplaySize.value,
    containerSize.value,
  )

  const newRotation = calculateRotationAngle(
    canvasPoint.x,
    canvasPoint.y,
    rotationState.value.centerPoint!.x,
    rotationState.value.centerPoint!.y,
  )

  setTransformRotationDeferred(newRotation)
}

async function handleRotateEnd(_event: MouseEvent) {
  if (!rotationState.value.isRotating) return

  await commitDeferredUpdates()
  rotationState.value.isRotating = false

  window.removeEventListener('mousemove', handleGlobalRotateMove)
  window.removeEventListener('mouseup', handleGlobalRotateEnd)
}

function handleGlobalRotateMove(event: MouseEvent) {
  handleRotateMove(event)
}

async function handleGlobalRotateEnd(event: MouseEvent) {
  await handleRotateEnd(event)
}

function clearSuppressCanvasClickTimer() {
  if (suppressNextCanvasClickTimer === null) return
  window.clearTimeout(suppressNextCanvasClickTimer)
  suppressNextCanvasClickTimer = null
}

function suppressCanvasClickOnce() {
  suppressNextCanvasClick.value = true
  clearSuppressCanvasClickTimer()
  // Keep suppression alive for the click generated by the current drag-end only.
  suppressNextCanvasClickTimer = window.setTimeout(() => {
    suppressNextCanvasClick.value = false
    suppressNextCanvasClickTimer = null
  }, 0)
}

function handleCanvasClick(event: MouseEvent): void {
  if (suppressNextCanvasClick.value) {
    clearSuppressCanvasClickTimer()
    suppressNextCanvasClick.value = false
    return
  }

  if (dragState.value.hasMoved) {
    dragState.value.hasMoved = false
    return
  }
  if (scaleState.value.hasMoved) {
    scaleState.value.hasMoved = false
    return
  }
  if (rotationState.value.hasMoved) {
    rotationState.value.hasMoved = false
    return
  }

  const rect = rendererContainerRef.value?.getBoundingClientRect()
  if (!rect) return

  const stagePoint = screenPointToStagePoint(event.clientX - rect.left, event.clientY - rect.top)

  const clickedItemId = findTimelineItemAtPosition(
    stagePoint.x,
    stagePoint.y,
    {
      width: canvasResolution.value.width,
      height: canvasResolution.value.height,
    },
    canvasDisplaySize.value,
    containerSize.value,
    currentFrame.value,
  )

  if (clickedItemId) {
    unifiedStore.selectTimelineSelection(buildClipSelectionId(clickedItemId))
  } else if (unifiedStore.selectedTimelineSelectionIds.size > 0) {
    unifiedStore.clearTimelineSelection()
  }
}

function findTimelineItemAtPosition(
  domX: number,
  domY: number,
  canvasResolutionArg: { width: number; height: number },
  canvasDisplaySizeArg: { width: number; height: number },
  containerSizeArg: { width: number; height: number },
  currentFrameArg: number,
): string | null {
  const canvasPoint = domToCanvasCoordinates(
    domX,
    domY,
    canvasResolutionArg,
    canvasDisplaySizeArg,
    containerSizeArg,
  )

  const visibleItems = getVisibleTimelineItems(
    unifiedStore.timelineItems,
    currentFrameArg,
    (trackId: string) => unifiedStore.getTrack(trackId),
  )

  if (visibleItems.length === 0) {
    return null
  }

  const trackIndexMap = new Map<string, number>()
  unifiedStore.tracks.forEach((track, index) => {
    trackIndexMap.set(track.id, index)
  })
  const sortedItems = sortTimelineItemsByTrackIndex(visibleItems, trackIndexMap)

  for (let i = 0; i < sortedItems.length; i++) {
    const item = sortedItems[i]

    if (!TimelineItemQueries.hasVisualProperties(item)) {
      continue
    }

    const renderConfig = TimelineItemQueries.getRenderConfig(item)

    const isHit = isPointInRotatedBoundingBox(canvasPoint, {
      x: renderConfig.x,
      y: renderConfig.y,
      width: renderConfig.width,
      height: renderConfig.height,
      rotation: renderConfig.rotation,
    })

    if (isHit) {
      return item.id
    }
  }

  return null
}

function handleContextMenu(event: MouseEvent): void {
  event.preventDefault()

  contextMenuOptions.value.x = event.clientX
  contextMenuOptions.value.y = event.clientY
  showContextMenu.value = true
}

async function captureCanvasFrame() {
  try {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5)
    const currentTime = unifiedStore.formattedCurrentTime
    const filename = `screenshot-${timestamp}-at-${currentTime}.png`

    console.log('📸 开始截取画布画面...')
    await unifiedStore.captureCanvasFrame(filename)
    console.log('✅ 画布截帧成功')
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error)
    console.error('❌ 画布截帧失败:', errorMessage)
  }
}

let resizeObserver: ResizeObserver | null = null

onMounted(async () => {
  await nextTick()
  updateContainerSize()

  rendererContainerRef.value?.addEventListener('wheel', handlePreviewWheel, { passive: false })

  if (rendererContainerRef.value) {
    resizeObserver = new ResizeObserver(() => {
      updateContainerSize()
    })
    resizeObserver.observe(rendererContainerRef.value)
  }
})

onUnmounted(() => {
  rendererContainerRef.value?.removeEventListener('wheel', handlePreviewWheel)
  window.removeEventListener('mousemove', handleGlobalMouseMove)
  window.removeEventListener('mouseup', handleGlobalMouseUp)
  window.removeEventListener('mousemove', handleGlobalScaleMove)
  window.removeEventListener('mouseup', handleGlobalScaleEnd)
  window.removeEventListener('mousemove', handleGlobalRotateMove)
  window.removeEventListener('mouseup', handleGlobalRotateEnd)
  window.removeEventListener('mousemove', handleGlobalPanMove)
  window.removeEventListener('mouseup', handleGlobalPanEnd)
  clearSuppressCanvasClickTimer()

  if (resizeObserver) {
    resizeObserver.disconnect()
  }
})
</script>

<style scoped>
.renderer-container {
  flex: 1;
  position: relative;
  background-color: var(--color-bg-primary);
  border-radius: var(--border-radius-medium);
  overflow: hidden;
  cursor: default;
}

.renderer-container.is-panning {
  cursor: grabbing;
}

.preview-stage-content {
  position: absolute;
  inset: 0;
}

.preview-reset-btn {
  position: absolute;
  right: var(--spacing-sm);
  bottom: var(--spacing-sm);
  z-index: 30;
  background-color: rgba(0, 0, 0, 0.45);
  backdrop-filter: blur(8px);
}
</style>
