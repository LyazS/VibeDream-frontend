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
      <div
        v-for="resolution in resolutionOptions"
        :key="resolution.name"
        class="resolution-option"
        :class="{
          active:
            tempSelectedResolution.name === resolution.name &&
            tempSelectedResolution.category !== '自定义',
        }"
        @click="selectPresetResolution(resolution)"
      >
        <div class="resolution-preview" :style="getPreviewStyle(resolution)"></div>
        <div class="resolution-info">
          <div class="resolution-name">{{ resolution.name }}</div>
          <div class="resolution-size">{{ resolution.width }} × {{ resolution.height }}</div>
          <div class="resolution-ratio">{{ resolution.aspectRatio }}</div>
        </div>
      </div>

      <!-- 自定义分辨率选项 -->
      <div
        class="resolution-option custom-option"
        :class="{ active: tempSelectedResolution.category === '自定义' }"
        @click="selectCustomResolution"
      >
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
  grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
  gap: 16px;
  max-height: 400px;
  overflow-y: auto;
}

.resolution-option {
  background-color: #333;
  border: 2px solid #444;
  border-radius: 8px;
  padding: 12px;
  cursor: pointer;
  transition: all 0.2s;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
}

.resolution-option:hover {
  border-color: #666;
  background-color: #3a3a3a;
}

.resolution-option.active {
  border-color: #ff4444;
  background-color: #4a2a2a;
}

.resolution-preview {
  background-color: #555;
  border: 1px solid #666;
  border-radius: 3px;
  transition: all 0.2s;
  flex-shrink: 0;
}

.resolution-option:hover .resolution-preview {
  background-color: #666;
  border-color: #777;
}

.resolution-option.active .resolution-preview {
  background-color: #ff4444;
  border-color: #ff6666;
}

.resolution-info {
  text-align: center;
  flex: 1;
}

.resolution-name {
  font-weight: bold;
  color: white;
  margin-bottom: 4px;
  font-size: 13px;
}

.resolution-size {
  color: #ccc;
  font-size: 11px;
  margin-bottom: 2px;
}

.resolution-ratio {
  color: #999;
  font-size: 10px;
  font-family: monospace;
}

/* 自定义分辨率输入（集成在选项内） */
.custom-inputs {
  width: 100%;
  margin-top: 4px;
}

.input-row {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-bottom: 6px;
}

.custom-input {
  flex: 1;
  padding: 4px 6px;
  background-color: #444;
  border: 1px solid #555;
  border-radius: 3px;
  color: white;
  font-size: 11px;
  text-align: center;
  min-width: 0;
}

.custom-input:focus {
  outline: none;
  border-color: #ff4444;
}

.input-separator {
  color: #ccc;
  font-size: 12px;
  font-weight: bold;
}

.custom-ratio {
  color: #999;
  font-size: 10px;
  font-family: monospace;
  text-align: center;
}

/* 滚动条样式已在全局样式中定义 */
</style>
