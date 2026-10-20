<template>
  <ModalOverlay
    v-if="show"
    :show="show"
    :z-index="2000"
    :overlay-style="{ background: 'rgba(0, 0, 0, 0.82)' }"
    @update:show="emit('update:show', $event)"
    @close="emit('close')"
    @open="focusPreview"
  >
    <section
      ref="dialog"
      class="media-preview"
      role="dialog"
      aria-modal="true"
      :aria-label="source?.name || t('media.preview.title')"
      tabindex="-1"
      @click.stop
    >
      <span class="preview-focus-guard" tabindex="0" @focus="focusBoundary('last')" />
      <header class="preview-header">
        <span v-if="source?.name" class="preview-name">{{ source.name }}</span>
        <button
          ref="closeButton"
          class="preview-button"
          type="button"
          :aria-label="t('common.close')"
          :title="t('common.close')"
          @click="close"
        >
          <RiCloseLine aria-hidden="true" />
        </button>
      </header>

      <div class="preview-stage" @click.self="close" @wheel="handleWheel">
        <div v-if="errorMessage" class="preview-status" role="alert">
          <RiFileDamageLine aria-hidden="true" />
          <span>{{ errorMessage }}</span>
        </div>
        <template v-else-if="source && (url || imageBitmap)">
          <component
            :is="imageBitmap ? 'canvas' : 'img'"
            v-if="source.type === 'image'"
            ref="imageElement"
            class="preview-image"
            :class="{ 'preview-image--dragging': dragging }"
            :src="imageBitmap ? undefined : url"
            :width="imageBitmap?.width"
            :height="imageBitmap?.height"
            :alt="source.name"
            role="img"
            :aria-label="source.name"
            :style="{ transform: `translate(${offsetX}px, ${offsetY}px) scale(${zoom})` }"
            :draggable="false"
            @load="loading = false"
            @error="failed = true"
            @pointerdown="startDrag"
            @pointermove="drag"
            @pointerup="stopDrag"
            @pointercancel="stopDrag"
            @lostpointercapture="cancelDrag"
            @dblclick="resetImage"
          />
          <video
            v-else-if="source.type === 'video'"
            ref="player"
            class="preview-video"
            :src="url"
            :aria-label="source.name"
            controls
            autoplay
            playsinline
            @loadeddata="loading = false"
            @error="failed = true"
          />
          <div v-else class="preview-audio">
            <RiMusic2Line class="preview-audio-icon" aria-hidden="true" />
            <span class="preview-audio-name">{{ source.name }}</span>
            <audio
              ref="player"
              :src="url"
              :aria-label="source.name"
              controls
              autoplay
              @loadeddata="loading = false"
              @error="failed = true"
            />
          </div>
        </template>
        <div v-if="loading && !errorMessage" class="preview-loading" role="status">
          <span class="preview-spinner" aria-hidden="true" />
          <span>{{ t('common.loading') }}</span>
        </div>
      </div>
      <div v-if="source?.type === 'image' && !errorMessage" class="preview-toolbar">
        <button
          class="preview-button"
          type="button"
          :disabled="loading || zoom <= 0.1"
          :aria-label="t('media.preview.zoomOut')"
          :title="t('media.preview.zoomOut')"
          @click="setZoom(zoom / 1.2)"
        >
          <RiZoomOutLine aria-hidden="true" />
        </button>
        <span class="preview-zoom">{{ Math.round(zoom * 100) }}%</span>
        <button
          class="preview-button"
          type="button"
          :disabled="loading || zoom >= 10"
          :aria-label="t('media.preview.zoomIn')"
          :title="t('media.preview.zoomIn')"
          @click="setZoom(zoom * 1.2)"
        >
          <RiZoomInLine aria-hidden="true" />
        </button>
        <button
          class="preview-button"
          type="button"
          :disabled="loading"
          :aria-label="t('media.preview.resetZoom')"
          :title="t('media.preview.resetZoom')"
          @click="resetImage"
        >
          <RiRefreshLine aria-hidden="true" />
        </button>
      </div>
      <p v-if="source?.type === 'image' && !errorMessage" class="preview-hint">
        {{ t('media.preview.interactionHint') }}
      </p>
      <span class="preview-focus-guard" tabindex="0" @focus="focusBoundary('first')" />
    </section>
  </ModalOverlay>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import {
  RiCloseLine,
  RiFileDamageLine,
  RiMusic2Line,
  RiRefreshLine,
  RiZoomInLine,
  RiZoomOutLine,
} from '@remixicon/vue'
import ModalOverlay from '@/components/modals/ModalOverlay.vue'
import { useAppI18n } from '@/core/composables/useI18n'
import type { MediaPreviewSource } from './mediaPreview'

const props = withDefaults(
  defineProps<{ show: boolean; source: MediaPreviewSource | null; error?: string }>(),
  { error: '' },
)
const emit = defineEmits<{ 'update:show': [value: boolean]; close: [] }>()
const { t } = useAppI18n()
const dialog = ref<HTMLElement>()
const closeButton = ref<HTMLButtonElement>()
const player = ref<HTMLMediaElement>()
const imageElement = ref<HTMLImageElement | HTMLCanvasElement>()
const imageBitmap = computed(() =>
  props.source && 'bitmap' in props.source ? props.source.bitmap : null,
)
const url = ref('')
const loading = ref(false)
const failed = ref(false)
const zoom = ref(1)
const offsetX = ref(0)
const offsetY = ref(0)
const dragging = ref(false)
const errorMessage = computed(
  () => props.error || (failed.value ? t('media.preview.loadFailed') : ''),
)
let previousFocus: HTMLElement | null = null
let lastX = 0
let lastY = 0
let pointerId: number | null = null
let disposed = false

function resetImage() {
  zoom.value = 1
  offsetX.value = offsetY.value = 0
  cancelDrag()
}

function releaseMedia() {
  player.value?.pause()
  if (url.value) URL.revokeObjectURL(url.value)
  url.value = ''
}

watch(
  () => [props.show, props.source] as const,
  ([show, source]) => {
    releaseMedia()
    resetImage()
    failed.value = false
    loading.value = false
    if (!show || !source) return
    loading.value = true
    if ('bitmap' in source) {
      // 等待 canvas 挂载；关闭或切换期间到达的绘制请求不应再访问旧素材。
      void nextTick().then(() => {
        if (disposed || !props.show || props.source !== source) return
        try {
          const canvas = imageElement.value
          if (!canvas || !('getContext' in canvas)) throw new Error('Canvas unavailable')
          const context = canvas.getContext('2d')
          if (!context) throw new Error('Canvas context unavailable')
          context.clearRect(0, 0, canvas.width, canvas.height)
          context.drawImage(source.bitmap, 0, 0)
          loading.value = false
        } catch {
          failed.value = true
        }
      })
      return
    }
    try {
      url.value = URL.createObjectURL(source.blob)
    } catch {
      failed.value = true
    }
  },
  { immediate: true, flush: 'sync' },
)

async function focusPreview() {
  previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null
  await nextTick()
  closeButton.value?.focus({ preventScroll: true })
}

function restoreFocus() {
  previousFocus?.focus({ preventScroll: true })
  previousFocus = null
}

watch(
  () => props.show,
  (show) => {
    if (!show) restoreFocus()
  },
)
onBeforeUnmount(() => {
  disposed = true
  releaseMedia()
  restoreFocus()
})

function close() {
  emit('update:show', false)
  emit('close')
}

// 使用焦点边界保留原生播放器内部各控件的 Tab 导航。
function focusBoundary(edge: 'first' | 'last') {
  const controls = dialog.value?.querySelectorAll<HTMLElement>(
    'button:not(:disabled), video[controls], audio[controls]',
  )
  if (!controls?.length) return
  controls[edge === 'first' ? 0 : controls.length - 1]?.focus()
}

function setZoom(value: number, x = 0, y = 0) {
  const nextZoom = Math.min(10, Math.max(0.1, value))
  const ratio = nextZoom / zoom.value
  offsetX.value = x - (x - offsetX.value) * ratio
  offsetY.value = y - (y - offsetY.value) * ratio
  zoom.value = nextZoom
}

function handleWheel(event: WheelEvent) {
  if (props.source?.type !== 'image' || loading.value || errorMessage.value) return
  event.preventDefault()
  event.stopPropagation()
  if (dragging.value) return
  const rect = (event.currentTarget as HTMLElement).getBoundingClientRect()
  // 与编辑画布保持一致：普通滚动（包括双指滑动）平移，捏合和修饰键滚动缩放。
  // 不按滚动幅度猜测硬件类型，避免触摸板快速滑动或惯性滚动突然变成缩放。
  const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? rect.height : 1
  const deltaX = event.deltaX * unit
  const deltaY = event.deltaY * unit
  if (!event.ctrlKey && !event.metaKey && !event.altKey) {
    if (event.shiftKey && deltaX === 0) {
      offsetX.value -= deltaY
    } else {
      offsetX.value -= deltaX
      offsetY.value -= deltaY
    }
    return
  }
  setZoom(
    zoom.value * Math.exp(-Math.max(-100, Math.min(100, deltaY)) * 0.0036),
    event.clientX - rect.left - rect.width / 2,
    event.clientY - rect.top - rect.height / 2,
  )
}

function startDrag(event: PointerEvent) {
  if ((event.button !== 0 && event.button !== 1) || loading.value || pointerId !== null) return
  event.preventDefault()
  event.stopPropagation()
  pointerId = event.pointerId
  dragging.value = true
  lastX = event.clientX
  lastY = event.clientY
  ;(event.currentTarget as HTMLElement).setPointerCapture(event.pointerId)
}

function drag(event: PointerEvent) {
  if (!dragging.value || pointerId !== event.pointerId) return
  offsetX.value += event.clientX - lastX
  offsetY.value += event.clientY - lastY
  lastX = event.clientX
  lastY = event.clientY
}

function stopDrag(event: PointerEvent) {
  if (pointerId !== event.pointerId) return
  cancelDrag()
  ;(event.currentTarget as HTMLElement).releasePointerCapture(event.pointerId)
}

function cancelDrag() {
  dragging.value = false
  pointerId = null
}
</script>

<style scoped>
.media-preview {
  position: fixed;
  inset: 0;
  min-width: 0;
  /* 平移和缩放只在视口边缘裁切，控制栏不再分割图片展示区域。 */
  overflow: clip;
  border: 0;
  outline: none;
  background: transparent;
  box-shadow: none;
  color: #fff;
}
.preview-header {
  position: absolute;
  z-index: 1;
  top: 24px;
  right: 24px;
  left: 24px;
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 16px;
  pointer-events: none;
}
.preview-header .preview-button {
  pointer-events: auto;
  background: rgba(0, 0, 0, 0.5);
}
.preview-header .preview-button:hover:not(:disabled) {
  background: rgba(0, 0, 0, 0.7);
}
.preview-focus-guard {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip-path: inset(50%);
}
.preview-name {
  margin-right: auto;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: rgba(255, 255, 255, 0.9);
  font-size: 13px;
  padding: 6px 10px;
  border-radius: 6px;
  background: rgba(0, 0, 0, 0.6);
}
.preview-stage {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 0;
  overflow: visible;
  overscroll-behavior: contain;
}
.preview-image,
.preview-video {
  display: block;
  flex: 0 1 auto;
  max-width: min(1600px, calc(100% - 96px));
  max-height: calc(100% - 176px);
  object-fit: contain;
}
.preview-image {
  cursor: grab;
  touch-action: none;
  user-select: none;
}
.preview-image--dragging {
  cursor: grabbing;
}
.preview-audio {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 24px;
  width: min(480px, 100%);
}
.preview-audio-icon {
  width: 72px;
  height: 72px;
  opacity: 0.7;
}
.preview-audio-name {
  max-width: 100%;
  overflow-wrap: anywhere;
  text-align: center;
}
.preview-audio audio {
  width: 100%;
}
.preview-toolbar {
  position: absolute;
  z-index: 1;
  bottom: 52px;
  left: 50%;
  transform: translateX(-50%);
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 4px 8px;
  border-radius: 999px;
  background: rgba(0, 0, 0, 0.5);
  backdrop-filter: blur(12px);
}
.preview-zoom {
  min-width: 54px;
  text-align: center;
  font-size: 13px;
  font-variant-numeric: tabular-nums;
}
.preview-hint {
  position: absolute;
  z-index: 1;
  right: 24px;
  bottom: 20px;
  left: 24px;
  pointer-events: none;
  margin: 0;
  color: rgba(255, 255, 255, 0.6);
  font-size: 12px;
  line-height: 1.5;
  text-align: center;
  text-wrap: balance;
  text-shadow: 0 1px 4px rgba(0, 0, 0, 0.8);
}
.preview-button {
  display: flex;
  align-items: center;
  justify-content: center;
  flex: 0 0 40px;
  width: 40px;
  height: 40px;
  padding: 8px;
  border: 0;
  border-radius: 50%;
  background: rgba(255, 255, 255, 0.08);
  color: #fff;
  cursor: pointer;
  transition:
    background-color 120ms,
    transform 120ms;
}
.preview-button svg {
  width: 22px;
  height: 22px;
}
.preview-button:hover:not(:disabled) {
  background: rgba(255, 255, 255, 0.18);
}
.preview-button:active:not(:disabled) {
  transform: scale(0.96);
}
.preview-button:focus-visible {
  outline: 2px solid #fff;
  outline-offset: 3px;
}
.preview-button:disabled {
  opacity: 0.35;
  cursor: default;
}
.preview-status,
.preview-loading {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 12px;
  font-size: 14px;
}
.preview-status svg {
  width: 40px;
  height: 40px;
}
.preview-loading {
  position: absolute;
  pointer-events: none;
}
.preview-spinner {
  width: 24px;
  height: 24px;
  border: 2px solid rgba(255, 255, 255, 0.25);
  border-top-color: #fff;
  border-radius: 50%;
  animation: preview-spin 0.8s linear infinite;
}
@keyframes preview-spin {
  to {
    transform: rotate(360deg);
  }
}
@media (prefers-reduced-motion: reduce) {
  .preview-spinner {
    animation: none;
  }
  .preview-button {
    transition: none;
  }
}
@media (max-width: 600px) {
  .preview-header {
    top: 12px;
    right: 12px;
    left: 12px;
  }
  .preview-image,
  .preview-video {
    max-width: calc(100% - 32px);
  }
  .preview-hint {
    right: 12px;
    bottom: 12px;
    left: 12px;
    font-size: 11px;
  }
  .preview-toolbar {
    bottom: 64px;
  }
}
</style>
