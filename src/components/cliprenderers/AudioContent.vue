<!-- AudioContentTemplate.vue -->
<template>
  <div class="audio-content" :class="{ selected: isSelected }">
    <!-- 波形Canvas容器 -->
    <!-- 音频波形Canvas - 添加拖拽事件处理 -->
    <canvas
      ref="waveformCanvas"
      :height="DEFAULT_TRACK_HEIGHTS.audio - 2 * DEFAULT_TRACK_PADDING"
      class="waveform-canvas"
      :style="{ left: canvasDisplayLeft + 'px' }"
      @dragstart.stop.prevent="handleInnerDrag"
    />
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, ref, watch, onMounted, onUnmounted } from 'vue'
import { throttle } from 'lodash'
import type { ClipRenderFrame, ContentTemplateProps } from '@/core/types/clipRenderer'
import { useUnifiedStore } from '@/core/unifiedStore'
import { calculateClipWidthPixels } from '@/core/utils/thumbnailLayout'
import { DEFAULT_TRACK_HEIGHTS, DEFAULT_TRACK_PADDING } from '@/constants/TrackConstants'
import { AudioWaveformLODGenerator } from '@/core/audiowaveform/AudioWaveformLODGenerator'
import { AudioWaveformLODSelector } from '@/core/audiowaveform/AudioWaveformLODSelector'
import { AudioWaveformRenderer } from '@/core/audiowaveform/AudioWaveformRenderer'
import type { BunnyMedia } from '@/core/mediabunny/bunny-media'
import type { UnifiedMediaItemData } from '@/core/mediaitem/types'

const props = defineProps<ContentTemplateProps<'audio'>>()
const unifiedStore = useUnifiedStore()

const waveformCanvas = ref<HTMLCanvasElement>()
const canvasLeft = ref(0)
const lastLiveRenderFrame = ref<ClipRenderFrame | null>(props.renderFrame ?? null)
const latchedDisplayRenderFrame = ref<ClipRenderFrame | null>(null)
const renderGeneration = ref(0)

// LOD选择器和渲染器实例
const lodSelector = new AudioWaveformLODSelector()
const waveformRenderer = new AudioWaveformRenderer()

// ⚠️ 关键：每个实例维护自己的版本号（用于多实例同步）
const currentLODVersion = ref(0)

// 采样波形计算属性
const sampleWaveform = computed(() => {
  const timeRange = props.data.timeRange
  const clipTLStartFrame = timeRange.timelineStartTime
  const clipTLEndFrame = timeRange.timelineEndTime
  const clipTLDurationFrames = clipTLEndFrame - clipTLStartFrame

  // 计算clip的像素宽度
  const clipWidthPixels = calculateClipWidthPixels(
    clipTLDurationFrames,
    props.timelineWidth,
    unifiedStore.totalDurationFrames,
    unifiedStore.zoomLevel,
  )

  // 检查是否在视口范围内
  const viewportStartFrame = props.viewportFrameRange.startFrames
  const viewportEndFrame = props.viewportFrameRange.endFrames

  if (clipTLStartFrame >= viewportEndFrame || clipTLEndFrame <= viewportStartFrame) {
    return null
  }

  const viewportTLStartFrame = Math.max(viewportStartFrame, clipTLStartFrame)
  const viewportTLEndFrame = Math.min(viewportEndFrame, clipTLEndFrame)

  return {
    viewportTLStartFrame,
    viewportTLEndFrame,
    clipWidthPixels: Math.floor(clipWidthPixels),
  }
})

const canvasDisplayLeft = computed(() => {
  const renderFrame = props.renderFrame ?? latchedDisplayRenderFrame.value
  const sample = sampleWaveform.value
  if (!renderFrame || !sample) {
    return canvasLeft.value
  }

  return Math.floor(renderFrame.frameToLocalPixel(sample.viewportTLStartFrame))
})

// 核心渲染逻辑 - 使用LOD系统（带版本号机制）
function renderWaveformInComponent() {
  if (!waveformCanvas.value || !sampleWaveform.value) {
    return
  }

  const { viewportTLStartFrame, viewportTLEndFrame, clipWidthPixels } = sampleWaveform.value

  // 获取mediaItem
  const mediaItem = unifiedStore.getMediaItem(props.data.mediaItemId)
  if (!mediaItem?.runtime.bunny?.bunnyMedia) {
    return
  }
  
  // ⚠️ 按需初始化LOD对象
  if (!mediaItem.runtime.bunny.waveformLOD) {
    mediaItem.runtime.bunny.waveformLOD = {
      levels: new Map(),
      metadata: {
        sampleRate: 0,
        channels: 0,
        duration: 0,
        totalSamples: 0,
      },
      status: 'pending',
      progress: 0,
      isGenerating: false,
      version: 0,
    }
  }
  
  const waveformLOD = mediaItem.runtime.bunny.waveformLOD
  
  // ⚠️ 检查是否需要触发生成
  if (waveformLOD.status !== 'ready') {
    // 清空Canvas
    const ctx = waveformCanvas.value.getContext('2d')
    if (ctx) {
      ctx.clearRect(0, 0, waveformCanvas.value.width, waveformCanvas.value.height)
    }
    
    // ⚠️ 防止重复生成
    if (!waveformLOD.isGenerating) {
      waveformLOD.isGenerating = true
      generateWaveformLODAsync(mediaItem, mediaItem.runtime.bunny.bunnyMedia)
    }
    
    return
  }
  
  // ⚠️ 检查版本号，如果LOD已更新，更新本地版本号
  if (currentLODVersion.value !== waveformLOD.version) {
    currentLODVersion.value = waveformLOD.version || 0
  }

  // 选择最优LOD层级
  const pixelsPerFrame = calculatePixelsPerFrame(
    clipWidthPixels,
    viewportTLEndFrame - viewportTLStartFrame,
    unifiedStore.zoomLevel
  )
  
  const selectedLevel = lodSelector.selectLODLevel(
    unifiedStore.zoomLevel,
    pixelsPerFrame,
    waveformLOD.metadata.sampleRate
  )
  
  const lodData = waveformLOD.levels.get(selectedLevel)
  if (!lodData) {
    console.warn(`LOD层级 ${selectedLevel} 数据不存在`)
    return
  }

  // ⚠️ 关键：计算视口可见范围的宽度和偏移
  const sourceTimeRange = props.data.timeRange
  const tlDurationFrames = sourceTimeRange.timelineEndTime - sourceTimeRange.timelineStartTime
  const sampleStartX =
    ((viewportTLStartFrame - sourceTimeRange.timelineStartTime) / tlDurationFrames) * clipWidthPixels
  const sampleEndX =
    ((viewportTLEndFrame - sourceTimeRange.timelineStartTime) / tlDurationFrames) * clipWidthPixels
  const sampleWidth = sampleEndX - sampleStartX

  // 更新canvas位置和宽度（只渲染可见部分）
  canvasLeft.value = Math.floor(sampleStartX)
  waveformCanvas.value.width = Math.floor(sampleWidth)

  // 计算时间范围（对应到clip内的时间）
  const clipDurationFrames = sourceTimeRange.clipEndTime - sourceTimeRange.clipStartTime
  const startFrameInClip = sourceTimeRange.clipStartTime +
    Math.round(((viewportTLStartFrame - sourceTimeRange.timelineStartTime) / tlDurationFrames) * clipDurationFrames)
  const endFrameInClip = sourceTimeRange.clipStartTime +
    Math.round(((viewportTLEndFrame - sourceTimeRange.timelineStartTime) / tlDurationFrames) * clipDurationFrames)
  
  const startTime = framesToSeconds(startFrameInClip)
  const endTime = framesToSeconds(endFrameInClip)

  // 创建渐变色
  const ctx = waveformCanvas.value.getContext('2d')
  if (!ctx) return
  const gradient = waveformRenderer.createGradient(
    ctx,
    DEFAULT_TRACK_HEIGHTS.audio - 2 * DEFAULT_TRACK_PADDING
  )

  // 渲染波形（只渲染可见范围）
  const canvasHeight = DEFAULT_TRACK_HEIGHTS.audio - 2 * DEFAULT_TRACK_PADDING
  waveformRenderer.renderRange(
    waveformCanvas.value,
    lodData,
    startTime,
    endTime,
    {
      width: Math.floor(sampleWidth),
      height: canvasHeight,
      amplitude: 1.0,
      baselineY: canvasHeight, // baseline在Canvas底部
      gradient,
    }
  )
}

// 节流渲染函数（333ms，与视频缩略图一致）
const throttledRenderWaveform = throttle(renderWaveformInComponent, 333, {
  leading: false,
  trailing: true,
})

function waitForLatchedWaveformPaint(): Promise<void> {
  return new Promise((resolve) => {
    // Keep the latched frame through one committed paint before returning to the real clip frame.
    requestAnimationFrame(() => {
      requestAnimationFrame(() => resolve())
    })
  })
}

watch(
  () => props.renderFrame,
  async (next, prev) => {
    if (next) {
      renderGeneration.value += 1
      lastLiveRenderFrame.value = next
      latchedDisplayRenderFrame.value = null
      return
    }

    const frameToLatch = prev ?? lastLiveRenderFrame.value
    if (!frameToLatch) {
      return
    }

    const generation = ++renderGeneration.value
    latchedDisplayRenderFrame.value = frameToLatch
    throttledRenderWaveform.cancel()
    await nextTick()
    renderWaveformInComponent()
    await waitForLatchedWaveformPaint()

    if (generation !== renderGeneration.value) {
      return
    }

    latchedDisplayRenderFrame.value = null
    lastLiveRenderFrame.value = null
  },
)

// 监听sampleWaveform变化（主要触发条件）
watch(
  () => sampleWaveform.value,
  (newValue) => {
    if (newValue && waveformCanvas.value) {
      throttledRenderWaveform()
    }
  },
  { deep: true },
)

// 组件挂载时初始渲染
onMounted(() => {
  if (sampleWaveform.value) {
    throttledRenderWaveform()
  }
})

// ⚠️ 关键：监听LOD版本号变化，自动重新渲染（多实例同步）
watch(
  () => {
    const mediaItem = unifiedStore.getMediaItem(props.data.mediaItemId)
    return mediaItem?.runtime.bunny?.waveformLOD?.version
  },
  (newVersion) => {
    if (newVersion !== undefined && newVersion !== currentLODVersion.value) {
      currentLODVersion.value = newVersion
      // ⚡ 版本号变化，触发重新渲染
      throttledRenderWaveform()
    }
  }
)

// 组件卸载时清理
onUnmounted(() => {
  renderGeneration.value += 1
  throttledRenderWaveform.cancel()
})

/**
 * 处理内部元素的拖拽事件 - 阻止浏览器默认行为
 * 确保拖拽时显示整个clip的预览，而不是Canvas元素的虚影
 */
function handleInnerDrag(event: DragEvent) {
  // 阻止Canvas元素的拖拽行为，让整个clip处理拖拽
  event.preventDefault()
  event.stopPropagation()
  return false
}

// ==================== LOD辅助函数 ====================

/**
 * 计算每帧像素数
 */
function calculatePixelsPerFrame(
  clipWidthPixels: number,
  durationFrames: number,
  zoomLevel: number
): number {
  return (clipWidthPixels * zoomLevel) / durationFrames
}

/**
 * 将帧数转换为秒
 */
function framesToSeconds(frames: number): number {
  return frames / 30 // 假设30fps
}

/**
 * 异步生成LOD数据（按需触发）
 * 这个函数在AudioContent.vue首次渲染时被调用
 */
async function generateWaveformLODAsync(
  mediaItem: UnifiedMediaItemData,
  bunnyMedia: BunnyMedia
) {
  try {
    const waveformLOD = mediaItem.runtime.bunny!.waveformLOD!
    waveformLOD.status = 'generating'
    
    const generator = new AudioWaveformLODGenerator()
    const result = await generator.generateFromBunnyMedia(
      bunnyMedia,
      (progress) => {
        waveformLOD.progress = progress
      }
    )
    
    // 更新LOD数据
    waveformLOD.levels = result.levels
    waveformLOD.metadata = result.metadata
    waveformLOD.status = 'ready'
    waveformLOD.progress = 100
    waveformLOD.generatedAt = Date.now()
    waveformLOD.isGenerating = false
    
    // ⚠️ 关键：更新版本号，通知所有实例重新渲染
    waveformLOD.version = (waveformLOD.version || 0) + 1
    
    // 触发当前实例重新渲染
    throttledRenderWaveform()
  } catch (error) {
    console.error('❌ LOD生成失败:', error)
    const waveformLOD = mediaItem.runtime.bunny!.waveformLOD!
    waveformLOD.status = 'error'
    waveformLOD.error = error instanceof Error ? error.message : String(error)
    waveformLOD.isGenerating = false
  }
}
</script>

<style scoped>
.audio-content {
  position: relative;
  width: 100%;
  height: 100%;
  overflow: hidden; /* 确保canvas不会超出容器边界 */
  border-radius: var(--border-radius-medium);
}

.waveform-canvas {
  /* 使用固定尺寸避免缩放问题 */
  width: auto;
  /* height: 40px; */
  background: rgba(0, 0, 0, 0); /* 添加背景以便调试 */
  display: block; /* 确保正确显示 */
  position: absolute; /* 使用absolute定位使left生效 */
}

/* 保持向后兼容的样式 */
.sample-number {
  font-size: 12px;
  color: white;
  font-weight: bold;
}

/* 选中状态样式 */
.audio-content.selected {
  background: linear-gradient(135deg, var(--color-clip-selected), var(--color-clip-selected-dark));
}
</style>
