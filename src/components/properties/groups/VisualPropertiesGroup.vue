<template>
  <div class="visual-properties-group">
    <div class="property-section">
      <h4>{{ t('properties.visual.visualProperties') }}</h4>

      <!-- 位置控制 -->
      <KeyframedDualNumberField
        :label="t('properties.transform.position')"
        :state="positionButtonState"
        :tooltip="getChannelKeyframeTooltip('transform.position')"
        :disabled="!canOperateTransforms"
        :has-previous="hasPreviousChannelKeyframe('transform.position')"
        :has-next="hasNextChannelKeyframe('transform.position')"
        :first-label="t('properties.transform.positionX')"
        :second-label="t('properties.transform.positionY')"
        :first-value="transformX"
        :second-value="transformY"
        :first-min="positionLimits.minX"
        :first-max="positionLimits.maxX"
        :second-min="positionLimits.minY"
        :second-max="positionLimits.maxY"
        :step="1"
        :precision="0"
        :first-placeholder="t('properties.transform.centerFor0')"
        :second-placeholder="t('properties.transform.centerFor0')"
        @first-input="setTransformXDeferred"
        @second-input="setTransformYDeferred"
        @first-change="commitTransformXDeferredUpdate"
        @second-change="commitTransformYDeferredUpdate"
        @previous="goToPreviousChannelKeyframe('transform.position')"
        @toggle="toggleChannelKeyframe('transform.position')"
        @next="goToNextChannelKeyframe('transform.position')"
      />

      <!-- 水平对齐 -->
      <div class="property-item">
          <label :class="getAnimatedLabelClass(positionButtonState)">
          {{ t('properties.transform.alignHorizontal') }}
        </label>
        <div class="alignment-controls">
          <button
            @click="alignHorizontal('left')"
            :disabled="!canOperateTransforms"
            class="align-btn"
            :title="t('properties.transform.left')"
          >
            <component :is="IconComponents.ALIGN_ITEM_LEFT" size="16px" />
          </button>
          <button
            @click="alignHorizontal('center')"
            :disabled="!canOperateTransforms"
            class="align-btn"
            :title="t('properties.transform.center')"
          >
            <component :is="IconComponents.ALIGN_ITEM_H_CENTER" size="16px" />
          </button>
          <button
            @click="alignHorizontal('right')"
            :disabled="!canOperateTransforms"
            class="align-btn"
            :title="t('properties.transform.right')"
          >
            <component :is="IconComponents.ALIGN_ITEM_RIGHT" size="16px" />
          </button>
        </div>
      </div>

      <!-- 垂直对齐 -->
      <div class="property-item">
          <label :class="getAnimatedLabelClass(positionButtonState)">
          {{ t('properties.transform.alignVertical') }}
        </label>
        <div class="alignment-controls">
          <button
            @click="alignVertical('top')"
            :disabled="!canOperateTransforms"
            class="align-btn"
            :title="t('properties.transform.top')"
          >
            <component :is="IconComponents.ALIGN_ITEM_TOP" size="16px" />
          </button>
          <button
            @click="alignVertical('middle')"
            :disabled="!canOperateTransforms"
            class="align-btn"
            :title="t('properties.transform.middle')"
          >
            <component :is="IconComponents.ALIGN_ITEM_V_CENTER" size="16px" />
          </button>
          <button
            @click="alignVertical('bottom')"
            :disabled="!canOperateTransforms"
            class="align-btn"
            :title="t('properties.transform.bottom')"
          >
            <component :is="IconComponents.ALIGN_ITEM_BOTTOM" size="16px" />
          </button>
        </div>
      </div>

      <!-- 等比缩放选项 -->
      <div class="property-item">
          <label :class="getAnimatedLabelClass(sizeButtonState)">
          {{ t('properties.transform.proportionalScale') }}
        </label>
        <input
          :checked="proportionalScale"
          @change="toggleProportionalScale"
          :disabled="!canOperateTransforms"
          type="checkbox"
          class="checkbox-input"
        />
      </div>

      <KeyframedDualNumberField
        :label="t('properties.transform.size')"
        :state="sizeButtonState"
        :tooltip="getChannelKeyframeTooltip('transform.size')"
        :disabled="!canOperateTransforms"
        :has-previous="hasPreviousChannelKeyframe('transform.size')"
        :has-next="hasNextChannelKeyframe('transform.size')"
        :first-label="t('properties.transform.width')"
        :second-label="t('properties.transform.height')"
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
        @previous="goToPreviousChannelKeyframe('transform.size')"
        @toggle="toggleChannelKeyframe('transform.size')"
        @next="goToNextChannelKeyframe('transform.size')"
      />

      <!-- 缩放预设 -->
      <div class="property-item">
        <label :class="getAnimatedLabelClass(sizeButtonState)">
          {{ t('properties.transform.scalePresets') }}
        </label>
        <div class="scale-preset-controls">
          <button @click="fitToCanvas" :disabled="!canOperateTransforms" class="preset-btn">
            {{ t('properties.transform.fitToCanvas') }}
          </button>
          <button @click="fillCanvas" :disabled="!canOperateTransforms" class="preset-btn">
            {{ t('properties.transform.fillCanvas') }}
          </button>
        </div>
      </div>
      <!-- 旋转 -->
      <KeyframedSliderField
        :label="t('properties.transform.rotation')"
        :state="rotationButtonState"
        :tooltip="getChannelKeyframeTooltip('transform.rotation')"
        :disabled="!canOperateTransforms"
        :has-previous="hasPreviousChannelKeyframe('transform.rotation')"
        :has-next="hasNextChannelKeyframe('transform.rotation')"
        :value="rotation"
        :min="-180"
        :max="180"
        :step="0.1"
        :precision="1"
        slider-class="rotation-slider"
        @slider-input="setRotationDeferred"
        @slider-change="commitRotationDeferredUpdate"
        @number-change="setRotationDirectly"
        @previous="goToPreviousChannelKeyframe('transform.rotation')"
        @toggle="toggleChannelKeyframe('transform.rotation')"
        @next="goToNextChannelKeyframe('transform.rotation')"
      />

      <div class="property-item">
        <label>{{ t('properties.transform.blendMode') }}</label>
        <SearchableSelect
          class="blend-mode-select"
          :model-value="blendMode"
          :options="blendModeOptions"
          :searchable="false"
          :disabled="!canOperateTransforms"
          :placeholder="t('properties.transform.blendMode')"
          @update:model-value="handleBlendModeChange"
        />
      </div>

      <!-- 混合强度 -->
      <KeyframedSliderField
        :label="t('properties.transform.blendIntensity')"
        :state="opacityButtonState"
        :tooltip="getChannelKeyframeTooltip('transform.opacity')"
        :disabled="!canOperateTransforms"
        :has-previous="hasPreviousChannelKeyframe('transform.opacity')"
        :has-next="hasNextChannelKeyframe('transform.opacity')"
        :value="opacity"
        :min="0"
        :max="1"
        :step="0.01"
        :precision="2"
        slider-class="opacity-slider"
        @slider-input="setOpacityDeferred"
        @slider-change="commitOpacityDeferredUpdate"
        @number-change="setOpacityDirectly"
        @previous="goToPreviousChannelKeyframe('transform.opacity')"
        @toggle="toggleChannelKeyframe('transform.opacity')"
        @next="goToNextChannelKeyframe('transform.opacity')"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { useAppI18n } from '@/core/composables/useI18n'
import { useUnifiedStore } from '@/core/unifiedStore'
import { useUnifiedKeyframeTransformControls } from '@/core/composables'
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

// 从关键帧控制器获取所有变换属性和方法
const {
  canOperateTransforms,
  transformX,
  transformY,
  displayWidth,
  displayHeight,
  rotation,
  opacity,
  blendMode,
  proportionalScale,
  toggleProportionalScale,
  setRotationDeferred,
  setOpacityDeferred,
  setWidthDeferred,
  setHeightDeferred,
  commitRotationDeferredUpdate,
  commitOpacityDeferredUpdate,
  setTransformXDeferred,
  setTransformYDeferred,
  commitTransformXDeferredUpdate,
  commitTransformYDeferredUpdate,
  commitWidthDeferredUpdate,
  commitHeightDeferredUpdate,

  // 直接更新方法（用于 NumberInput）
  setTransformXDirectly,
  setTransformYDirectly,
  setWidthDirectly,
  setHeightDirectly,
  fitToCanvas,
  fillCanvas,
  setRotationDirectly,
  setOpacityDirectly,
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
} = useUnifiedKeyframeTransformControls({
  selectedTimelineItem: computed(() => props.selectedTimelineItem),
  currentFrame: computed(() => props.currentFrame),
})

const positionButtonState = computed(() => getChannelButtonState('transform.position'))
const sizeButtonState = computed(() => getChannelButtonState('transform.size'))
const rotationButtonState = computed(() => getChannelButtonState('transform.rotation'))
const opacityButtonState = computed(() => getChannelButtonState('transform.opacity'))

const blendModeOptions = computed(() =>
  BLEND_MODE_VALUES.map((value) => ({
    value,
    label: t(`properties.transform.blendModes.${value}`),
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
