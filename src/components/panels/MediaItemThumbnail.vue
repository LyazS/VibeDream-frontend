<template>
  <div
    class="media-thumbnail"
    @dragstart="handleDragStart"
    @dragend="handleDragEnd"
  >
    <!-- 等待状态 -->
    <template v-if="item?.mediaStatus === 'pending'">
      <div class="async-processing-display">
        <div class="processing-status pending">
          <div class="status-icon">
            <component :is="IconComponents.TIME" size="20px" spin />
          </div>
        </div>
      </div>
      <!-- 时长标签 -->
      <div v-if="item?.mediaType === 'video' || item?.mediaType === 'audio'" class="duration-badge">
        {{ t('media.badge.waiting') }}
      </div>
    </template>

    <!-- 异步处理中状态 -->
    <template v-else-if="item?.mediaStatus === 'asyncprocessing'">
      <div class="async-processing-display">
        <div class="processing-status processing">
          <div
            class="progress-circle"
            :style="{ '--progress': item.source.progress }"
          >
            <div class="progress-text">{{ item.source.progress.toFixed(2) }}%</div>
          </div>
        </div>
      </div>
      <!-- 时长标签 -->
      <div v-if="item?.mediaType === 'video' || item?.mediaType === 'audio'" class="duration-badge">
        {{ t('media.badge.processing') }}
      </div>
    </template>

    <!-- 解析中状态 -->
    <template v-else-if="item?.mediaStatus === 'decoding'">
      <div class="thumbnail-placeholder">
        <div class="loading-spinner"></div>
      </div>
      <!-- 时长标签 -->
      <div v-if="item?.mediaType === 'video' || item?.mediaType === 'audio'" class="duration-badge">
        {{ t('media.badge.parsing') }}
      </div>
    </template>

    <!-- 错误状态 -->
    <template v-else-if="item?.mediaStatus === 'error'">
      <div class="local-error-display">
        <div class="status-icon">
          <component :is="IconComponents.WARNING" size="20px" />
        </div>
      </div>
      <!-- 时长标签 -->
      <div v-if="item?.mediaType === 'video' || item?.mediaType === 'audio'" class="duration-badge">
        {{ t('media.badge.failed') }}
      </div>
    </template>

    <!-- 已取消状态 -->
    <template v-else-if="item?.mediaStatus === 'cancelled'">
      <div class="local-error-display">
        <div class="status-icon">
          <component :is="IconComponents.CLOSE" size="20px" />
        </div>
      </div>
      <!-- 时长标签 -->
      <div v-if="item?.mediaType === 'video' || item?.mediaType === 'audio'" class="duration-badge">
        {{ t('media.badge.cancelled') }}
      </div>
    </template>

    <!-- 就绪状态：显示缩略图 -->
    <template v-else-if="item">
      <!-- 优先使用缩略图 -->
      <img
        v-if="item.runtime.bunny?.thumbnailUrl"
        :src="item.runtime.bunny.thumbnailUrl"
        class="thumbnail-image"
      />
      <!-- 音频类型显示音乐图标 -->
      <div v-else-if="item.mediaType === 'audio'" class="audio-icon-container">
        <component :is="IconComponents.MUSIC" size="48px" />
      </div>
      <!-- 缩略图生成中的占位符 -->
      <div v-else class="thumbnail-placeholder">
        <component :is="IconComponents.IMAGE_SMALL" size="20px" />
      </div>

      <!-- 右上角时长标签（视频和音频显示） -->
      <div v-if="item.mediaType === 'video' || item.mediaType === 'audio'" class="duration-badge">
        {{
          item.mediaStatus === 'ready' && item.duration ? formatDuration(item.duration) : t('media.badge.processing')
        }}
      </div>
    </template>

    <!-- 未知状态 -->
    <template v-else>
      <div class="thumbnail-placeholder">
        <component :is="IconComponents.QUESTION" size="20px" />
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { useUnifiedStore } from '@/core/unifiedStore'
import { useAppI18n } from '@/core/composables/useI18n'
import { framesToTimecodeCompact } from '@/core/utils/timeUtils'
import { IconComponents } from '@/constants/iconComponents'

interface Props {
  mediaId: string
}

const props = defineProps<Props>()
const unifiedStore = useUnifiedStore()
const { t } = useAppI18n()

// 获取媒体项
const item = computed(() => unifiedStore.getMediaItem(props.mediaId))

// 拖拽开始处理
function handleDragStart() {
  // 可以在这里添加拖拽开始时的逻辑
}

// 拖拽结束处理
function handleDragEnd() {
  // 可以在这里添加拖拽结束时的逻辑
}

// 格式化时长显示（使用时间码格式）
function formatDuration(frames: number): string {
  return framesToTimecodeCompact(frames).replace(/\+\d+$/, '')
}
</script>

<style scoped>
.media-thumbnail {
  width: 100%;
  height: 100%;
  background-color: transparent;
  border-radius: var(--border-radius-small);
  position: relative;
  overflow: hidden;
  display: flex;
  align-items: flex-end;
  justify-content: center;
}

.thumbnail-image {
  width: 100%;
  height: 100%;
  object-fit: contain;
  object-position: center;
}

.thumbnail-placeholder {
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  background-color: rgba(0, 0, 0, 0.1);
  color: var(--color-text-secondary);
}

.audio-icon-container {
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--color-primary);
}

.loading-spinner {
  width: 16px;
  height: 16px;
  border: 1px solid rgba(255, 255, 255, 0.3);
  border-top: 1px solid var(--color-text-primary);
  border-radius: 50%;
  animation: spin 1s linear infinite;
}

@keyframes spin {
  0% {
    transform: rotate(0deg);
  }
  100% {
    transform: rotate(360deg);
  }
}

.duration-badge {
  position: absolute;
  top: 2px;
  right: 2px;
  background-color: rgba(107, 114, 128, 0.65);
  color: white;
  font-size: 9px;
  padding: 2px 4px;
  border-radius: 3px;
  z-index: 2;
  font-family: monospace;
  line-height: 1;
}

/* 异步处理素材样式 */
.async-processing-display {
  width: 100%;
  height: 100%;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  background: var(--color-surface-variant);
  border-radius: 8px;
}

.processing-status {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 100%;
  height: 100%;
}

.processing-status .status-icon {
  display: flex;
  align-items: center;
  justify-content: center;
}

.processing-status.pending .status-icon {
  color: var(--color-status-pending);
}

.processing-status.processing .status-icon {
  color: var(--color-status-processing);
}

.processing-status.error .status-icon {
  color: var(--color-status-error);
}

.progress-circle {
  width: 32px;
  height: 32px;
  border-radius: 50%;
  background: conic-gradient(
    from 0deg,
    var(--color-status-processing) 0deg,
    var(--color-status-processing) calc(var(--progress, 0) * 3.6deg),
    var(--color-progress-background) calc(var(--progress, 0) * 3.6deg),
    var(--color-progress-background) 360deg
  );
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
}

.progress-circle::before {
  content: '';
  position: absolute;
  top: 3px;
  left: 3px;
  right: 3px;
  bottom: 3px;
  border-radius: 50%;
  background: var(--color-surface);
  z-index: 1;
}

.progress-text {
  position: relative;
  z-index: 2;
  font-size: 10px;
  font-weight: 700;
  color: #ffffff;
  line-height: 1;
  text-shadow: 0 1px 2px rgba(0, 0, 0, 0.5);
}

/* 本地媒体项错误状态样式 */
.local-error-display {
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--color-surface-variant);
  border-radius: 8px;
}

.local-error-display .status-icon {
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--color-status-error);
}
</style>
