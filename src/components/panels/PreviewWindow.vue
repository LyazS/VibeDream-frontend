<template>
  <div class="preview-window">
    <PreviewCanvasStage />

    <!-- 播放控制面板紧贴在预览窗口下方 -->
    <div class="controls-section">
      <!-- 时间显示 -->
      <div class="time-display">
        {{ framesToTimecodeCompact(unifiedStore.currentFrame) }}/{{
          framesToTimecodeCompact(
            unifiedStore.contentEndTimeFrames || unifiedStore.totalDurationFrames,
          )
        }}
      </div>
      <!-- 中间播放控制 -->
      <div class="center-controls">
        <HoverButton
          variant="primary"
          @click="togglePlayPause"
          :title="isPlaying ? t('common.pause') : t('common.play')"
        >
          <template #icon>
            <component :is="getPlaybackIcon(isPlaying)" size="16px" />
          </template>
        </HoverButton>

        <HoverButton @click="stop" :title="t('common.stop')">
          <template #icon>
            <component :is="IconComponents.STOP" size="16px" />
          </template>
        </HoverButton>
      </div>
      <!-- 右侧比例按钮 -->
      <button
        class="aspect-ratio-btn"
        @click="showResolutionModal = true"
        :title="t('editor.setVideoResolution')"
      >
        <span class="aspect-ratio-text">{{ currentResolutionText }}</span>
      </button>
    </div>

    <!-- 分辨率选择弹窗 -->
    <ResolutionModal
      :show="showResolutionModal"
      :current-resolution="currentResolution"
      @close="showResolutionModal = false"
      @confirm="handleResolutionConfirm"
    />
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue'
import PreviewCanvasStage from '@/components/preview/PreviewCanvasStage.vue'
import ResolutionModal from '@/components/modals/ResolutionModal.vue'
import HoverButton from '@/components/base/HoverButton.vue'
import { IconComponents, getPlaybackIcon } from '@/constants/iconComponents'
import { useUnifiedStore } from '@/core/unifiedStore'
import { framesToTimecodeCompact } from '@/core/utils/timeUtils'
import { useAppI18n } from '@/core/composables/useI18n'

const unifiedStore = useUnifiedStore()
const { t } = useAppI18n()

// 分辨率弹窗显示状态
const showResolutionModal = ref(false)

// 播放状态
const isPlaying = computed(() => unifiedStore.isPlaying)

// 统一播放控制接口
function togglePlayPause() {
  if (isPlaying.value) {
    unifiedStore.pause()
  } else {
    unifiedStore.play()
  }
}

function stop() {
  unifiedStore.stop()
}

// 从videoStore获取当前分辨率，而不是使用硬编码的默认值
const currentResolution = computed(() => {
  const resolution = unifiedStore.videoResolution
  // 根据分辨率判断类别
  const aspectRatio = resolution.width / resolution.height
  let category = t('editor.landscape')
  if (aspectRatio < 1) {
    category = t('editor.portrait')
  } else if (Math.abs(aspectRatio - 1) < 0.1) {
    category = t('editor.square')
  }

  return {
    name: resolution.name,
    width: resolution.width,
    height: resolution.height,
    aspectRatio: resolution.aspectRatio,
    category: category,
  }
})

const currentResolutionText = computed(() => {
  return `${currentResolution.value.aspectRatio}`
})

function handleResolutionConfirm(resolution: {
  name: string
  width: number
  height: number
  aspectRatio: string
}) {
  // 更新videoStore中的分辨率
  unifiedStore.setVideoResolution(resolution)
  console.log('确认选择分辨率:', resolution)
}
</script>

<style scoped>
.preview-window {
  width: 100%;
  flex: 1;
  background-color: var(--color-bg-secondary);
  border-radius: var(--border-radius-xlarge);
  overflow: hidden;
  position: relative;
  display: flex;
  flex-direction: column;
  border: 2px solid var(--color-bg-secondary);
  box-sizing: border-box;
  min-width: 150px;
  min-height: 100px;
}

.controls-section {
  height: 50px;
  width: 100%;
  background-color: var(--color-bg-secondary);
  border-radius: var(--border-radius-large);
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 var(--spacing-md);
  flex-shrink: 0;
  min-width: 200px;
  overflow: hidden;
}

.time-display {
  color: var(--color-text-secondary);
  font-size: var(--font-size-base);
  font-family: monospace;
  flex-shrink: 0;
}

.center-controls {
  flex: 1;
  display: flex;
  justify-content: center;
  background-color: var(--color-bg-secondary);
}

.aspect-ratio-btn {
  background: none;
  border: 1px solid var(--color-border-primary);
  color: var(--color-text-secondary);
  cursor: pointer;
  padding: var(--spacing-xs) var(--spacing-md);
  border-radius: var(--border-radius-medium);
  display: flex;
  align-items: center;
  gap: var(--spacing-xs);
  font-size: var(--font-size-sm);
  transition: all var(--transition-fast);
}

.aspect-ratio-btn:hover {
  background-color: var(--color-bg-quaternary);
  border-color: var(--color-border-secondary);
  color: var(--color-text-primary);
}

.aspect-ratio-text {
  font-family: monospace;
}
</style>
