<template>
  <!-- 导出设置对话框 -->
  <UniversalModal
    :show="show"
    :title="t('editor.exportSettings')"
    @close="handleClose"
    @confirm="handleExport"
    @cancel="handleClose"
    :confirm-disabled="!form.title.trim()"
    :confirm-text="t('editor.export')"
    :cancel-text="t('common.cancel')"
  >
    <div class="modal-form-fields">
      <!-- 视频标题 -->
      <ModalFormField :label="t('editor.videoTitle')" input-id="export-title">
        <input
          id="export-title"
          v-model="form.title"
          type="text"
          :placeholder="t('editor.videoTitlePlaceholder')"
          maxlength="100"
          @keydown.enter="handleExport"
        />
      </ModalFormField>

      <!-- 导出类型 -->
      <ModalFormField :label="t('editor.exportType')">
        <div class="radio-group">
          <label class="radio-option" :class="{ active: form.exportType === 'video' }">
            <input type="radio" v-model="form.exportType" value="video" name="exportType" />
            <span class="radio-label">{{ t('editor.exportTypeVideo') }}</span>
          </label>
          <label class="radio-option" :class="{ active: form.exportType === 'audio' }">
            <input type="radio" v-model="form.exportType" value="audio" name="exportType" />
            <span class="radio-label">{{ t('editor.exportTypeAudio') }}</span>
          </label>
        </div>
        <template #hint>{{ getExportTypeHint(form.exportType) }}</template>
      </ModalFormField>

      <!-- 视频相关设置：仅在导出视频时显示 -->
      <template v-if="form.exportType === 'video'">
        <!-- 帧率选择 -->
        <ModalFormField :label="t('editor.frameRate')" input-id="frame-rate">
          <select id="frame-rate" v-model="form.frameRate">
            <option :value="8">{{ t('editor.frameRate8') }}</option>
            <option :value="12">{{ t('editor.frameRate12') }}</option>
            <option :value="16">{{ t('editor.frameRate16') }}</option>
            <option :value="20">{{ t('editor.frameRate20') }}</option>
            <option :value="24">{{ t('editor.frameRate24') }}</option>
            <option :value="25">{{ t('editor.frameRate25') }}</option>
            <option :value="30">{{ t('editor.frameRate30') }}</option>
            <option :value="50">{{ t('editor.frameRate50') }}</option>
            <option :value="60">{{ t('editor.frameRate60') }}</option>
          </select>
          <template #hint>{{ getFrameRateHint(form.frameRate) }}</template>
        </ModalFormField>

        <!-- 视频质量 -->
        <ModalFormField :label="t('editor.videoQuality')" input-id="video-quality">
          <select id="video-quality" v-model="form.videoQuality">
            <option value="very_low">{{ t('editor.qualityVeryLow') }}</option>
            <option value="low">{{ t('editor.qualityLow') }}</option>
            <option value="medium">{{ t('editor.qualityMedium') }}</option>
            <option value="high">{{ t('editor.qualityHigh') }}</option>
            <option value="very_high">{{ t('editor.qualityVeryHigh') }}</option>
          </select>
          <template #hint>{{ getVideoQualityHint(form.videoQuality) }}</template>
        </ModalFormField>
      </template>

      <!-- 音频质量 -->
      <ModalFormField :label="t('editor.audioQuality')" input-id="audio-quality">
        <select id="audio-quality" v-model="form.audioQuality">
          <option value="very_low">{{ t('editor.qualityVeryLow') }}</option>
          <option value="low">{{ t('editor.qualityLow') }}</option>
          <option value="medium">{{ t('editor.qualityMedium') }}</option>
          <option value="high">{{ t('editor.qualityHigh') }}</option>
          <option value="very_high">{{ t('editor.qualityVeryHigh') }}</option>
        </select>
        <template #hint>{{ getAudioQualityHint(form.audioQuality) }}</template>
      </ModalFormField>
    </div>
  </UniversalModal>
</template>

<script setup lang="ts">
import { ref, watch } from 'vue'
import UniversalModal from './UniversalModal.vue'
import ModalFormField from '@/components/base/ModalFormField.vue'
import { useAppI18n } from '@/core/composables/useI18n'
import {
  QUALITY_VERY_LOW,
  QUALITY_LOW,
  QUALITY_MEDIUM,
  QUALITY_HIGH,
  QUALITY_VERY_HIGH,
  type Quality,
} from 'mediabunny'
import type { ExportType } from '@/core/utils/projectExporter'

const { t } = useAppI18n()

type QualityLevel = 'very_low' | 'low' | 'medium' | 'high' | 'very_high'

interface Props {
  show: boolean
  defaultTitle?: string
}

interface ExportSettings {
  title: string
  exportType: ExportType
  videoQuality: Quality
  audioQuality: Quality
  frameRate: number
}

interface Emits {
  (e: 'close'): void
  (e: 'export', settings: ExportSettings): void
}

const props = withDefaults(defineProps<Props>(), {
  defaultTitle: '',
})

const emit = defineEmits<Emits>()

// 表单数据（内部使用字符串）
const form = ref<{
  title: string
  exportType: ExportType
  videoQuality: QualityLevel
  audioQuality: QualityLevel
  frameRate: number
}>({
  title: props.defaultTitle || '',
  exportType: 'video',
  videoQuality: 'medium',
  audioQuality: 'medium',
  frameRate: 30,
})

// 监听模态框打开，更新表单数据
watch(
  () => props.show,
  (newShow) => {
    if (newShow) {
      // 模态框打开时，重置表单为默认值
      form.value.title = props.defaultTitle || ''
    }
  },
)

// 将字符串质量级别转换为 Quality 对象
function qualityLevelToQuality(level: QualityLevel): Quality {
  switch (level) {
    case 'very_low':
      return QUALITY_VERY_LOW
    case 'low':
      return QUALITY_LOW
    case 'medium':
      return QUALITY_MEDIUM
    case 'high':
      return QUALITY_HIGH
    case 'very_high':
      return QUALITY_VERY_HIGH
  }
}

// 处理关闭
function handleClose() {
  emit('close')
}

// 处理导出
function handleExport() {
  if (!form.value.title.trim()) {
    return
  }

  emit('export', {
    title: form.value.title.trim(),
    exportType: form.value.exportType,
    videoQuality: qualityLevelToQuality(form.value.videoQuality),
    audioQuality: qualityLevelToQuality(form.value.audioQuality),
    frameRate: form.value.frameRate,
  })
}

// 获取帧率提示
function getFrameRateHint(frameRate: number): string {
  const hints: Record<number, string> = {
    8: t('editor.frameRate8Hint'),
    12: t('editor.frameRate12Hint'),
    16: t('editor.frameRate16Hint'),
    20: t('editor.frameRate20Hint'),
    24: t('editor.frameRate24Hint'),
    25: t('editor.frameRate25Hint'),
    30: t('editor.frameRate30Hint'),
    50: t('editor.frameRate50Hint'),
    60: t('editor.frameRate60Hint'),
  }
  return hints[frameRate] || ''
}

// 获取视频质量提示
function getVideoQualityHint(level: QualityLevel): string {
  const hints: Record<QualityLevel, string> = {
    very_low: t('editor.videoQualityVeryLowHint'),
    low: t('editor.videoQualityLowHint'),
    medium: t('editor.videoQualityMediumHint'),
    high: t('editor.videoQualityHighHint'),
    very_high: t('editor.videoQualityVeryHighHint'),
  }
  return hints[level]
}

// 获取音频质量提示
function getAudioQualityHint(level: QualityLevel): string {
  const hints: Record<QualityLevel, string> = {
    very_low: t('editor.audioQualityVeryLowHint'),
    low: t('editor.audioQualityLowHint'),
    medium: t('editor.audioQualityMediumHint'),
    high: t('editor.audioQualityHighHint'),
    very_high: t('editor.audioQualityVeryHighHint'),
  }
  return hints[level]
}

// 获取导出类型提示
function getExportTypeHint(type: ExportType): string {
  return type === 'audio' ? t('editor.exportTypeAudioHint') : t('editor.exportTypeVideoHint')
}
</script>

<style scoped>
.modal-form-fields {
  display: flex;
  flex-direction: column;
  gap: var(--spacing-xxl);
}

.radio-group {
  display: flex;
  gap: var(--spacing-xl);
}

.radio-option {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: var(--spacing-lg) var(--spacing-xl);
  background: var(--color-bg-secondary);
  border: 1px solid var(--color-bg-hover);
  border-radius: var(--border-radius-medium);
  cursor: pointer;
  transition-property: background-color, border-color, color;
  transition-duration: var(--transition-fast);
  transition-timing-function: ease-out;
  user-select: none;
}

.radio-option:hover {
  background: var(--color-bg-hover);
  border-color: var(--color-border-hover);
}

.radio-option.active {
  background: var(--color-accent-primary-alpha);
  border-color: var(--color-primary);
  box-shadow: 0 0 0 1px var(--color-primary);
  color: var(--color-text-primary);
}

.radio-option input[type='radio'] {
  display: none;
}

.radio-label {
  font-size: var(--font-size-sm);
  font-weight: 500;
}
</style>
