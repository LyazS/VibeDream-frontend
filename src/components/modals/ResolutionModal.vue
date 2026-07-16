<template>
  <UniversalModal
    :show="show"
    :title="t('editor.selectVideoResolution')"
    @close="closeModal"
    @confirm="confirmSelection"
    @cancel="cancelSelection"
    :width="800"
    :max-width="'95%'"
    :max-height="'85vh'"
    :confirm-text="t('common.confirm')"
    :cancel-text="t('common.cancel')"
  >
    <!-- 预设分辨率 -->
    <div class="resolution-grid">
      <button
        v-for="resolution in resolutionOptions"
        :key="resolution.name"
        type="button"
        class="resolution-option"
        :class="{
          active:
            tempSelectedResolution.name === resolution.name &&
            tempSelectedResolution.category !== '自定义',
        }"
        :aria-pressed="
          tempSelectedResolution.name === resolution.name &&
          tempSelectedResolution.category !== '自定义'
        "
        @click="selectPresetResolution(resolution)"
      >
        <span class="selection-check" aria-hidden="true"><RiCheckLine size="14" /></span>
        <div class="resolution-preview" :style="getPreviewStyle(resolution)"></div>
        <div class="resolution-info">
          <div class="resolution-name">{{ resolution.name }}</div>
          <div class="resolution-size">{{ resolution.width }} × {{ resolution.height }}</div>
          <div class="resolution-ratio">{{ resolution.aspectRatio }}</div>
        </div>
      </button>

      <!-- 自定义分辨率选项 -->
      <div
        class="resolution-option custom-option"
        :class="{ active: tempSelectedResolution.category === '自定义' }"
        role="button"
        tabindex="0"
        :aria-pressed="tempSelectedResolution.category === '自定义'"
        @click="selectCustomResolution"
        @keydown.enter.prevent="selectCustomResolution"
        @keydown.space.prevent="selectCustomResolution"
      >
        <span class="selection-check" aria-hidden="true"><RiCheckLine size="14" /></span>
        <div
          class="resolution-preview"
          :style="getPreviewStyle({ width: customWidth, height: customHeight })"
        ></div>
        <div class="resolution-info">
          <div class="resolution-name">{{ t('editor.custom') }}</div>
          <div v-if="!showCustomInput" class="resolution-size">
            {{ customWidth }} × {{ customHeight }}
          </div>
          <div v-if="!showCustomInput" class="resolution-ratio">
            {{ customResolutionText }}
          </div>

          <!-- 自定义分辨率输入（集成在选项内） -->
          <div v-if="showCustomInput" class="custom-inputs">
            <div class="input-row">
              <input
                type="number"
                v-model.number="customWidth"
                min="1"
                max="7680"
                class="custom-input"
                :placeholder="t('editor.width')"
                @click.stop
              />
              <span class="input-separator">×</span>
              <input
                type="number"
                v-model.number="customHeight"
                min="1"
                max="4320"
                class="custom-input"
                :placeholder="t('editor.height')"
                @click.stop
              />
            </div>
            <div class="custom-ratio">{{ customResolutionText }}</div>
          </div>
        </div>
      </div>
    </div>
  </UniversalModal>
</template>

<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import { RiCheckLine } from '@remixicon/vue'
import UniversalModal from './UniversalModal.vue'
import { useAppI18n } from '@/core/composables/useI18n'
import {
  createProjectCustomResolution,
  listProjectResolutionPresets,
  type ProjectResolutionValue,
} from '@/core/utils/projectResolutionPresets'

interface ModalResolutionValue extends ProjectResolutionValue {
  name: string
}

const props = defineProps<{
  show: boolean
  currentResolution: ModalResolutionValue
}>()

const emit = defineEmits<{
  (e: 'close'): void
  (
    e: 'confirm',
    resolution: { name: string; width: number; height: number; aspectRatio: string },
  ): void
}>()

const { t } = useAppI18n()
const resolutionOptions = computed(() => listProjectResolutionPresets())

// 临时选择的分辨率
const tempSelectedResolution = ref<ModalResolutionValue>({
  name: '1080p',
  width: 1920,
  height: 1080,
  aspectRatio: '16:9',
  category: t('editor.landscape'),
})

// 自定义分辨率
const showCustomInput = ref(false)
const customWidth = ref(1920)
const customHeight = ref(1080)

const customResolutionText = computed(
  () => createProjectCustomResolution(customWidth.value, customHeight.value).aspectRatio,
)

// 监听自定义分辨率输入变化，实时更新临时选择
watch([customWidth, customHeight], () => {
  if (showCustomInput.value) {
    tempSelectedResolution.value = {
      ...createProjectCustomResolution(customWidth.value, customHeight.value),
    }
  }
})

// 监听props变化，初始化状态
watch(
  () => props.show,
  (show) => {
    if (show) {
      initializeModal()
    }
  },
  { immediate: true },
)

function initializeModal() {
  // 初始化临时选择为当前分辨率
  tempSelectedResolution.value = {
    name: props.currentResolution.name,
    width: props.currentResolution.width,
    height: props.currentResolution.height,
    aspectRatio: props.currentResolution.aspectRatio,
    category: props.currentResolution.category,
  }

  showCustomInput.value = false

  // 如果当前分辨率是自定义的，显示自定义输入
  if (props.currentResolution.category === t('editor.custom')) {
    showCustomInput.value = true
    customWidth.value = props.currentResolution.width
    customHeight.value = props.currentResolution.height
  }
}

function closeModal() {
  emit('close')
}

function confirmSelection() {
  let selectedResolution

  if (showCustomInput.value) {
    // 使用自定义分辨率
    selectedResolution = createProjectCustomResolution(customWidth.value, customHeight.value)
  } else {
    // 使用预设分辨率，转换为VideoResolution格式
    selectedResolution = {
      name: tempSelectedResolution.value.name,
      width: tempSelectedResolution.value.width,
      height: tempSelectedResolution.value.height,
      aspectRatio: tempSelectedResolution.value.aspectRatio,
    }
  }

  emit('confirm', selectedResolution)
  closeModal()
}

function cancelSelection() {
  closeModal()
  // 重置临时选择为当前分辨率
  tempSelectedResolution.value = {
    name: props.currentResolution.name,
    width: props.currentResolution.width,
    height: props.currentResolution.height,
    aspectRatio: props.currentResolution.aspectRatio,
    category: props.currentResolution.category,
  }
  showCustomInput.value = false
}

function selectPresetResolution(resolution: {
  name: string
  width: number
  height: number
  aspectRatio: string
  category: string
}) {
  showCustomInput.value = false
  tempSelectedResolution.value = resolution
}

function selectCustomResolution() {
  showCustomInput.value = true
  tempSelectedResolution.value = {
    ...createProjectCustomResolution(customWidth.value, customHeight.value),
  }
}

// 获取预览样式（根据分辨率比例）
function getPreviewStyle(resolution: { width: number; height: number }) {
  const aspectRatio = resolution.width / resolution.height
  const maxWidth = 60 // 最大宽度
  const maxHeight = 40 // 最大高度

  let width, height
  if (aspectRatio > maxWidth / maxHeight) {
    // 宽度受限
    width = maxWidth
    height = maxWidth / aspectRatio
  } else {
    // 高度受限
    height = maxHeight
    width = maxHeight * aspectRatio
  }

  return {
    width: `${width}px`,
    height: `${height}px`,
  }
}
</script>

<style scoped>
/* 通用Modal的样式已经包含在UniversalModal组件中 */
/* 这里只需要定义内容区域特有的样式 */
.resolution-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
  gap: var(--spacing-md);
  max-height: 440px;
  overflow-y: auto;
  padding: 2px;
}

.resolution-option {
  position: relative;
  min-height: 104px;
  box-sizing: border-box;
  appearance: none;
  background-color: var(--color-bg-secondary);
  border: 1px solid var(--color-border-primary);
  border-radius: var(--border-radius-large);
  padding: var(--spacing-md);
  color: inherit;
  font: inherit;
  cursor: pointer;
  transition-property: background-color, border-color, box-shadow, transform, scale;
  transition-duration: var(--transition-fast);
  transition-timing-function: ease-out;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: var(--spacing-sm);
}

.resolution-option:hover {
  border-color: var(--color-border-secondary);
  background-color: var(--color-bg-hover);
  transform: translateY(-1px);
}

.resolution-option.active {
  border-color: color-mix(in srgb, var(--color-primary) 65%, transparent);
  background-color: var(--color-accent-primary-alpha);
  box-shadow: inset 0 0 0 1px var(--color-primary), 0 2px 6px rgba(0, 0, 0, 0.2);
}

.resolution-option:focus-visible {
  outline: 2px solid var(--color-accent-secondary);
  outline-offset: 2px;
}

.resolution-option:active {
  scale: 0.96;
}

.selection-check {
  position: absolute;
  top: var(--spacing-sm);
  right: var(--spacing-sm);
  display: flex;
  align-items: center;
  justify-content: center;
  width: 18px;
  height: 18px;
  border-radius: 50%;
  background: var(--color-primary);
  color: var(--color-text-primary);
  opacity: 0;
  scale: 0.25;
  filter: blur(4px);
  transition-property: filter, opacity, scale;
  transition-duration: var(--transition-fast);
  transition-timing-function: cubic-bezier(0.2, 0, 0, 1);
}

.resolution-option.active .selection-check {
  opacity: 1;
  scale: 1;
  filter: blur(0);
}

.resolution-preview {
  background-color: var(--color-bg-active);
  border-radius: var(--border-radius-small);
  transition-property: background-color, box-shadow;
  transition-duration: var(--transition-fast);
  transition-timing-function: ease-out;
  flex-shrink: 0;
}

.resolution-option:hover .resolution-preview {
  background-color: var(--color-border-secondary);
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.08);
}

.resolution-option.active .resolution-preview {
  background-color: var(--color-primary);
}

.resolution-info {
  text-align: center;
}

.resolution-name {
  font-weight: 600;
  color: var(--color-text-primary);
  margin-bottom: var(--spacing-xxs);
  font-size: var(--font-size-md);
}

.resolution-size {
  color: var(--color-text-secondary);
  font-size: var(--font-size-sm);
  margin-bottom: var(--spacing-xxs);
  font-variant-numeric: tabular-nums;
}

.resolution-ratio {
  color: var(--color-text-hint);
  font-size: var(--font-size-xs);
  font-family: monospace;
  font-variant-numeric: tabular-nums;
}

.custom-option {
  grid-column: span 2;
}

/* 自定义分辨率输入（集成在选项内） */
.custom-inputs {
  width: 100%;
  margin-top: var(--spacing-xs);
}

.input-row {
  display: flex;
  align-items: center;
  gap: var(--spacing-sm);
  margin-bottom: var(--spacing-sm);
}

.custom-input {
  flex: 1;
  padding: var(--spacing-xs) var(--spacing-sm);
  background-color: var(--color-bg-secondary);
  border: 1px solid var(--color-bg-hover);
  border-radius: var(--border-radius-small);
  color: var(--color-text-primary);
  font-size: var(--font-size-sm);
  text-align: center;
  min-width: 0;
  font-variant-numeric: tabular-nums;
  transition-property: background-color, border-color, box-shadow;
  transition-duration: var(--transition-fast);
  transition-timing-function: ease-out;
}

.custom-input:focus {
  outline: none;
  border-color: var(--color-primary);
  box-shadow: 0 0 0 2px var(--color-accent-primary-alpha);
}

@media (max-width: 560px) {
  .resolution-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .custom-option {
    grid-column: span 2;
  }
}

.input-separator {
  color: var(--color-text-secondary);
  font-size: var(--font-size-base);
  font-weight: bold;
}

.custom-ratio {
  color: var(--color-text-hint);
  font-size: var(--font-size-xs);
  font-family: monospace;
  text-align: center;
  font-variant-numeric: tabular-nums;
}

/* 滚动条样式已在全局样式中定义 */
</style>
