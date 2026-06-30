<template>
  <div class="visual-properties-group">
    <div class="property-section">
      <h4>{{ t('properties.visual.visualProperties') }}</h4>

      <!-- 位置控制 -->
      <KeyframedDualNumberField
        :label="t('properties.visual.position')"
        :state="positionButtonState"
        :tooltip="getChannelKeyframeTooltip('visual.position')"
        :disabled="!canOperateVisualChannels"
        :has-previous="hasPreviousChannelKeyframe('visual.position')"
        :has-next="hasNextChannelKeyframe('visual.position')"
        :first-label="t('properties.visual.positionX')"
        :second-label="t('properties.visual.positionY')"
        :first-value="visualX"
        :second-value="visualY"
        :first-min="positionLimits.minX"
        :first-max="positionLimits.maxX"
        :second-min="positionLimits.minY"
        :second-max="positionLimits.maxY"
        :step="1"
        :precision="0"
        :first-placeholder="t('properties.visual.centerFor0')"
        :second-placeholder="t('properties.visual.centerFor0')"
        @first-input="setVisualXDeferred"
        @second-input="setVisualYDeferred"
        @first-change="commitVisualXDeferredUpdate"
        @second-change="commitVisualYDeferredUpdate"
        @previous="goToPreviousChannelKeyframe('visual.position')"
        @toggle="toggleChannelKeyframe('visual.position')"
        @next="goToNextChannelKeyframe('visual.position')"
      />

      <!-- 水平对齐 -->
      <div class="property-item">
          <label :class="getAnimatedLabelClass(positionButtonState)">
          {{ t('properties.visual.alignHorizontal') }}
        </label>
        <div class="alignment-controls">
          <button
            @click="alignHorizontal('left')"
            :disabled="!canOperateVisualChannels"
            class="align-btn"
            :title="t('properties.visual.left')"
          >
            <component :is="IconComponents.ALIGN_ITEM_LEFT" size="16px" />
          </button>
          <button
            @click="alignHorizontal('center')"
            :disabled="!canOperateVisualChannels"
            class="align-btn"
            :title="t('properties.visual.center')"
          >
            <component :is="IconComponents.ALIGN_ITEM_H_CENTER" size="16px" />
          </button>
          <button
            @click="alignHorizontal('right')"
            :disabled="!canOperateVisualChannels"
            class="align-btn"
            :title="t('properties.visual.right')"
          >
            <component :is="IconComponents.ALIGN_ITEM_RIGHT" size="16px" />
          </button>
        </div>
      </div>

      <!-- 垂直对齐 -->
      <div class="property-item">
          <label :class="getAnimatedLabelClass(positionButtonState)">
          {{ t('properties.visual.alignVertical') }}
        </label>
        <div class="alignment-controls">
          <button
            @click="alignVertical('top')"
            :disabled="!canOperateVisualChannels"
            class="align-btn"
            :title="t('properties.visual.top')"
          >
            <component :is="IconComponents.ALIGN_ITEM_TOP" size="16px" />
          </button>
          <button
            @click="alignVertical('middle')"
            :disabled="!canOperateVisualChannels"
            class="align-btn"
            :title="t('properties.visual.middle')"
          >
            <component :is="IconComponents.ALIGN_ITEM_V_CENTER" size="16px" />
          </button>
          <button
            @click="alignVertical('bottom')"
            :disabled="!canOperateVisualChannels"
            class="align-btn"
            :title="t('properties.visual.bottom')"
          >
            <component :is="IconComponents.ALIGN_ITEM_BOTTOM" size="16px" />
          </button>
        </div>
      </div>

      <!-- 等比缩放选项 -->
      <div class="property-item">
          <label :class="getAnimatedLabelClass(sizeButtonState)">
          {{ t('properties.visual.proportionalScale') }}
        </label>
        <input
          :checked="proportionalScale"
          @change="toggleProportionalScale"
          :disabled="!canOperateVisualChannels"
          type="checkbox"
          class="checkbox-input"
        />
      </div>

      <KeyframedDualNumberField
        :label="t('properties.visual.size')"
        :state="sizeButtonState"
        :tooltip="getChannelKeyframeTooltip('visual.size')"
        :disabled="!canOperateVisualChannels"
        :has-previous="hasPreviousChannelKeyframe('visual.size')"
        :has-next="hasNextChannelKeyframe('visual.size')"
        :first-label="t('properties.visual.width')"
        :second-label="t('properties.visual.height')"
        :first-value="displayWidth"
        :second-value="displayHeight"
        :first-min="sizeLimits.min"
        :first-max="sizeLimits.max"
        :second-min="sizeLimits.min"
        :second-max="sizeLimits.max"
        :step="1"
        :precision="0"
        @first-input="setWidthDeferred"
        @second-input="setHeightDeferred"
        @first-change="commitWidthDeferredUpdate"
        @second-change="commitHeightDeferredUpdate"
        @previous="goToPreviousChannelKeyframe('visual.size')"
        @toggle="toggleChannelKeyframe('visual.size')"
        @next="goToNextChannelKeyframe('visual.size')"
      />

      <!-- 缩放预设 -->
      <div class="property-item">
        <label :class="getAnimatedLabelClass(sizeButtonState)">
          {{ t('properties.visual.scalePresets') }}
        </label>
        <div class="scale-preset-controls">
          <button @click="fitToCanvas" :disabled="!canOperateVisualChannels" class="preset-btn">
            {{ t('properties.visual.fitToCanvas') }}
          </button>
          <button @click="fillCanvas" :disabled="!canOperateVisualChannels" class="preset-btn">
            {{ t('properties.visual.fillCanvas') }}
          </button>
        </div>
      </div>
      <!-- 旋转 -->
      <KeyframedSliderField
        :label="t('properties.visual.rotation')"
        :state="rotationButtonState"
        :tooltip="getChannelKeyframeTooltip('visual.rotation')"
        :disabled="!canOperateVisualChannels"
        :has-previous="hasPreviousChannelKeyframe('visual.rotation')"
        :has-next="hasNextChannelKeyframe('visual.rotation')"
        :value="rotation"
        :min="-180"
        :max="180"
        :step="0.1"
        :precision="1"
        slider-class="rotation-slider"
        @slider-input="setRotationDeferred"
        @slider-change="commitRotationDeferredUpdate"
        @number-change="setRotationDirectly"
        @previous="goToPreviousChannelKeyframe('visual.rotation')"
        @toggle="toggleChannelKeyframe('visual.rotation')"
        @next="goToNextChannelKeyframe('visual.rotation')"
      />

      <div class="property-item">
        <label>{{ t('properties.visual.blendMode') }}</label>
        <SearchableSelect
          class="blend-mode-select"
          :model-value="blendMode"
          :options="blendModeOptions"
          :searchable="false"
          :disabled="!canOperateVisualChannels"
          :placeholder="t('properties.visual.blendMode')"
          @update:model-value="handleBlendModeChange"
        />
      </div>

      <!-- 混合强度 -->
      <KeyframedSliderField
        :label="t('properties.visual.blendIntensity')"
        :state="blendIntensityButtonState"
        :tooltip="getChannelKeyframeTooltip('visual.blendIntensity')"
        :disabled="!canOperateVisualChannels"
        :has-previous="hasPreviousChannelKeyframe('visual.blendIntensity')"
        :has-next="hasNextChannelKeyframe('visual.blendIntensity')"
        :value="blendIntensity"
        :min="0"
        :max="1"
        :step="0.01"
        :precision="2"
        slider-class="opacity-slider"
        @slider-input="setBlendIntensityDeferred"
        @slider-change="commitBlendIntensityDeferredUpdate"
        @number-change="setBlendIntensityDirectly"
        @previous="goToPreviousChannelKeyframe('visual.blendIntensity')"
        @toggle="toggleChannelKeyframe('visual.blendIntensity')"
        @next="goToNextChannelKeyframe('visual.blendIntensity')"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { useAppI18n } from '@/core/composables/useI18n'
import { useUnifiedStore } from '@/core/unifiedStore'
import { useUnifiedKeyframeVisualControls } from '@/core/composables'
import { IconComponents } from '@/constants/iconComponents'
import type { BlendMode, UnifiedTimelineItemData } from '@/core/timelineitem/model/timelineItem'
import { BLEND_MODE_VALUES } from '@/core/timelineitem/model/blendMode'
import SearchableSelect from '@/components/base/SearchableSelect.vue'
import KeyframedDualNumberField from '@/components/properties/common/KeyframedDualNumberField.vue'
import KeyframedSliderField from '@/components/properties/common/KeyframedSliderField.vue'

interface Props {
  selectedTimelineItem: UnifiedTimelineItemData | null
  currentFrame: number
}

const props = defineProps<Props>()
const { t } = useAppI18n()
const unifiedStore = useUnifiedStore()

// 从关键帧控制器获取所有视觉/音频通道相关能力
const {
  canOperateVisualChannels,
  visualX,
  visualY,
  displayWidth,
  displayHeight,
  rotation,
  blendIntensity,
  blendMode,
  proportionalScale,
  toggleProportionalScale,
  setRotationDeferred,
  setBlendIntensityDeferred,
  setWidthDeferred,
  setHeightDeferred,
  commitRotationDeferredUpdate,
  commitBlendIntensityDeferredUpdate,
  setVisualXDeferred,
  setVisualYDeferred,
  commitVisualXDeferredUpdate,
  commitVisualYDeferredUpdate,
  commitWidthDeferredUpdate,
  commitHeightDeferredUpdate,

  // 直接更新方法（用于 NumberInput）
  setVisualXDirectly,
  setVisualYDirectly,
  setWidthDirectly,
  setHeightDirectly,
  fitToCanvas,
  fillCanvas,
  setRotationDirectly,
  setBlendIntensityDirectly,
  setBlendModeDirectly,

  alignHorizontal,
  alignVertical,
  getChannelButtonState,
  hasPreviousChannelKeyframe,
  hasNextChannelKeyframe,
  goToPreviousChannelKeyframe,
  goToNextChannelKeyframe,
  toggleChannelKeyframe,
  getChannelKeyframeTooltip,
} = useUnifiedKeyframeVisualControls({
  selectedTimelineItem: computed(() => props.selectedTimelineItem),
  currentFrame: computed(() => props.currentFrame),
})

const positionButtonState = computed(() => getChannelButtonState('visual.position'))
const sizeButtonState = computed(() => getChannelButtonState('visual.size'))
const rotationButtonState = computed(() => getChannelButtonState('visual.rotation'))
const blendIntensityButtonState = computed(() => getChannelButtonState('visual.blendIntensity'))

const blendModeOptions = computed(() =>
  BLEND_MODE_VALUES.map((value) => ({
    value,
    label: t(`properties.visual.blendModes.${value}`),
  })),
)

const getAnimatedLabelClass = (state: string) => ({
  'animated-property-label': state !== 'none',
  'animated-property-label--on-keyframe': state === 'on-keyframe',
  'animated-property-label--between-keyframes': state === 'between-keyframes',
})

// 位置限制
const positionLimits = computed(() => ({
  minX: -unifiedStore.videoResolution.width,
  maxX: unifiedStore.videoResolution.width,
  minY: -unifiedStore.videoResolution.height,
  maxY: unifiedStore.videoResolution.height,
}))

const sizeLimits = computed(() => ({
  min: 1,
  max: Math.max(unifiedStore.videoResolution.width, unifiedStore.videoResolution.height) * 4,
}))

const handleBlendModeChange = async (value: BlendMode) => {
  await setBlendModeDirectly(value)
}
</script>

<style scoped>
.visual-properties-group {
  width: 100%;
}

.position-controls {
  display: flex;
  gap: var(--spacing-xs);
  align-items: center;
  flex: 1;
}

.position-input-group {
  display: flex;
  align-items: center;
  gap: var(--spacing-xs);
  flex: 1;
}

.position-label {
  color: var(--color-text-secondary);
  font-size: var(--font-size-sm);
  min-width: 12px;
}

.checkbox-input {
  width: 16px;
  height: 16px;
  accent-color: var(--color-text-primary);
  cursor: pointer;
}

.scale-preset-controls {
  display: flex;
  gap: var(--spacing-xs);
  flex: 1;
}

.alignment-controls {
  display: flex;
  gap: var(--spacing-xs);
}

.align-btn {
  background: var(--color-bg-active);
  border: 1px solid var(--color-border-secondary);
  border-radius: var(--border-radius-medium);
  color: var(--color-text-secondary);
  padding: var(--spacing-xs);
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all var(--transition-fast);
  flex: 1;
  min-width: 28px;
  height: 24px;
}

.preset-btn {
  background: var(--color-bg-active);
  border: 1px solid var(--color-border-secondary);
  border-radius: var(--border-radius-medium);
  color: var(--color-text-secondary);
  padding: var(--spacing-xs) var(--spacing-sm);
  cursor: pointer;
  font-size: var(--font-size-sm);
  transition: all var(--transition-fast);
  flex: 1;
  min-height: 24px;
}

.preset-btn:hover {
  background: var(--color-border-secondary);
  color: var(--color-text-primary);
  border-color: var(--color-border-hover);
}

.preset-btn:active {
  background: var(--color-border-hover);
  transform: translateY(1px);
}

.align-btn:hover {
  background: var(--color-border-secondary);
  color: var(--color-text-primary);
  border-color: var(--color-border-hover);
}

.align-btn:active {
  background: var(--color-border-hover);
  transform: translateY(1px);
}

.align-btn:disabled,
.preset-btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
  background: var(--color-bg-tertiary);
  color: var(--color-text-muted);
  border-color: var(--color-border-secondary);
  box-shadow: none;
}

.align-btn:disabled:hover,
.preset-btn:disabled:hover {
  transform: none;
  box-shadow: none;
  background: var(--color-bg-tertiary);
  border-color: var(--color-border-secondary);
}

.align-btn svg {
  width: 14px;
  height: 14px;
}

.rotation-controls,
.opacity-controls {
  display: flex;
  align-items: center;
  gap: var(--spacing-xs);
  flex: 1;
}

.blend-mode-select {
  flex: 1;
}

.animated-property-label--on-keyframe {
  color: #5ba6ff;
}

.animated-property-label--between-keyframes {
  color: #d9a441;
}

/* 区域标题头部布局 */
.section-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: var(--spacing-sm);
}

.section-header h4 {
  margin: 0;
  color: var(--color-text-primary);
  font-size: var(--font-size-base);
  font-weight: 600;
}
</style>
