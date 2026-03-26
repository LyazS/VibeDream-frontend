<template>
  <div class="visual-properties-group">
    <div class="property-section">
      <h4>{{ t('properties.visual.visualProperties') }}</h4>

      <!-- 位置控制 -->
      <div class="property-item">
        <label :class="getAnimatedLabelClass(layoutButtonState)">
          {{ t('properties.transform.position') }}
        </label>
        <div class="position-controls">
          <div class="position-input-group">
            <span class="position-label">{{ t('properties.transform.positionX') }}</span>
            <NumberInput
              :model-value="transformX"
              @change="setTransformXDirectly"
              :disabled="!canOperateTransforms"
              :min="positionLimits.minX"
              :max="positionLimits.maxX"
              :step="1"
              :precision="0"
              :placeholder="t('properties.transform.centerFor0')"
            />
          </div>
          <div class="position-input-group">
            <span class="position-label">{{ t('properties.transform.positionY') }}</span>
            <NumberInput
              :model-value="transformY"
              @change="setTransformYDirectly"
              :disabled="!canOperateTransforms"
              :min="positionLimits.minY"
              :max="positionLimits.maxY"
              :step="1"
              :precision="0"
              :placeholder="t('properties.transform.centerFor0')"
            />
          </div>
          <div class="keyframe-nav-group">
            <button
              class="keyframe-nav-btn"
              :disabled="!canOperateTransforms || !hasPreviousChannelKeyframe('layout')"
              :title="t('properties.keyframes.previousKeyframe')"
              @click="goToPreviousChannelKeyframe('layout')"
            >
              <component :is="IconComponents.PREV_KEYFRAME" size="11px" />
            </button>
            <button
              class="property-keyframe-btn"
              :class="`state-${layoutButtonState}`"
              :title="getChannelKeyframeTooltip('layout')"
              :disabled="!canOperateTransforms"
              @click="toggleChannelKeyframe('layout')"
            >
              ◆
            </button>
            <button
              class="keyframe-nav-btn"
              :disabled="!canOperateTransforms || !hasNextChannelKeyframe('layout')"
              :title="t('properties.keyframes.nextKeyframe')"
              @click="goToNextChannelKeyframe('layout')"
            >
              <component :is="IconComponents.NEXT_KEYFRAME" size="11px" />
            </button>
          </div>
        </div>
      </div>

      <!-- 水平对齐 -->
      <div class="property-item">
        <label :class="getAnimatedLabelClass(layoutButtonState)">
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
        <label :class="getAnimatedLabelClass(layoutButtonState)">
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
        <label :class="getAnimatedLabelClass(layoutButtonState)">
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

      <!-- 等比缩放控制 -->
      <div v-if="proportionalScale" class="property-item">
        <label :class="getAnimatedLabelClass(layoutButtonState)">
          {{ t('properties.transform.scale') }}
        </label>
        <div class="scale-controls">
          <SliderInput
            :model-value="uniformScale"
            @input="updateUniformScaleDeferred"
            @change="commitDeferredUpdates"
            :disabled="!canOperateTransforms"
            :min="0.01"
            :max="5"
            :step="0.01"
          />
          <NumberInput
            :model-value="uniformScale"
            @change="updateUniformScaleDirectly"
            :disabled="!canOperateTransforms"
            :min="0.01"
            :max="5"
            :step="0.01"
            :precision="2"
            :show-controls="false"
            input-class="scale-input"
          />
        </div>
      </div>

      <!-- 非等比缩放控制 -->
      <template v-else>
        <div class="property-item">
          <label :class="getAnimatedLabelClass(layoutButtonState)">
            {{ t('properties.transform.scaleX') }}
          </label>
          <div class="scale-controls">
            <SliderInput
              :model-value="scaleX"
              @input="setScaleXDeferred"
              @change="commitDeferredUpdates"
              :disabled="!canOperateTransforms"
              :min="0.01"
              :max="5"
              :step="0.01"
            />
            <NumberInput
              :model-value="scaleX"
              @change="setScaleXDirectly"
              :disabled="!canOperateTransforms"
              :min="0.01"
              :max="5"
              :step="0.01"
              :precision="2"
              :show-controls="false"
              input-class="scale-input"
            />
          </div>
        </div>
        <div class="property-item">
          <label :class="getAnimatedLabelClass(layoutButtonState)">
            {{ t('properties.transform.scaleY') }}
          </label>
          <div class="scale-controls">
            <SliderInput
              :model-value="scaleY"
              @input="setScaleYDeferred"
              @change="commitDeferredUpdates"
              :disabled="!canOperateTransforms"
              :min="0.01"
              :max="5"
              :step="0.01"
            />
            <NumberInput
              :model-value="scaleY"
              @change="setScaleYDirectly"
              :disabled="!canOperateTransforms"
              :min="0.01"
              :max="5"
              :step="0.01"
              :precision="2"
              :show-controls="false"
              input-class="scale-input"
            />
          </div>
        </div>
      </template>

      <!-- 缩放预设 -->
      <div class="property-item">
        <label :class="getAnimatedLabelClass(layoutButtonState)">
          {{ t('properties.transform.scalePresets') }}
        </label>
        <div class="scale-preset-controls">
          <button @click="handleFitToCanvas" :disabled="!canOperateTransforms" class="preset-btn">
            {{ t('properties.transform.fitToCanvas') }}
          </button>
          <button @click="handleFillCanvas" :disabled="!canOperateTransforms" class="preset-btn">
            {{ t('properties.transform.fillCanvas') }}
          </button>
        </div>
      </div>
      <!-- 旋转 -->
      <div class="property-item">
        <label :class="getAnimatedLabelClass(rotationButtonState)">
          {{ t('properties.transform.rotation') }}
        </label>
        <div class="rotation-controls">
          <SliderInput
            :model-value="rotation"
            @input="setRotationDeferred"
            @change="commitDeferredUpdates"
            :disabled="!canOperateTransforms"
            :min="-180"
            :max="180"
            :step="0.1"
            slider-class="rotation-slider"
          />
          <NumberInput
            :model-value="rotation"
            @change="setRotationDirectly"
            :disabled="!canOperateTransforms"
            :step="1"
            :precision="1"
            :show-controls="false"
            input-class="scale-input"
          />
          <div class="keyframe-nav-group">
            <button
              class="keyframe-nav-btn"
              :disabled="!canOperateTransforms || !hasPreviousChannelKeyframe('rotation')"
              :title="t('properties.keyframes.previousKeyframe')"
              @click="goToPreviousChannelKeyframe('rotation')"
            >
              <component :is="IconComponents.PREV_KEYFRAME" size="11px" />
            </button>
            <button
              class="property-keyframe-btn"
              :class="`state-${rotationButtonState}`"
              :title="getChannelKeyframeTooltip('rotation')"
              :disabled="!canOperateTransforms"
              @click="toggleChannelKeyframe('rotation')"
            >
              ◆
            </button>
            <button
              class="keyframe-nav-btn"
              :disabled="!canOperateTransforms || !hasNextChannelKeyframe('rotation')"
              :title="t('properties.keyframes.nextKeyframe')"
              @click="goToNextChannelKeyframe('rotation')"
            >
              <component :is="IconComponents.NEXT_KEYFRAME" size="11px" />
            </button>
          </div>
        </div>
      </div>

      <!-- 透明度 -->
      <div class="property-item">
        <label :class="getAnimatedLabelClass(opacityButtonState)">
          {{ t('properties.transform.opacity') }}
        </label>
        <div class="opacity-controls">
          <SliderInput
            :model-value="opacity"
            @input="setOpacityDeferred"
            @change="commitDeferredUpdates"
            :disabled="!canOperateTransforms"
            :min="0"
            :max="1"
            :step="0.01"
            slider-class="opacity-slider"
          />
          <NumberInput
            :model-value="opacity"
            @change="setOpacityDirectly"
            :disabled="!canOperateTransforms"
            :min="0"
            :max="1"
            :step="0.01"
            :precision="2"
            :show-controls="false"
            input-class="scale-input"
          />
          <div class="keyframe-nav-group">
            <button
              class="keyframe-nav-btn"
              :disabled="!canOperateTransforms || !hasPreviousChannelKeyframe('opacity')"
              :title="t('properties.keyframes.previousKeyframe')"
              @click="goToPreviousChannelKeyframe('opacity')"
            >
              <component :is="IconComponents.PREV_KEYFRAME" size="11px" />
            </button>
            <button
              class="property-keyframe-btn"
              :class="`state-${opacityButtonState}`"
              :title="getChannelKeyframeTooltip('opacity')"
              :disabled="!canOperateTransforms"
              @click="toggleChannelKeyframe('opacity')"
            >
              ◆
            </button>
            <button
              class="keyframe-nav-btn"
              :disabled="!canOperateTransforms || !hasNextChannelKeyframe('opacity')"
              :title="t('properties.keyframes.nextKeyframe')"
              @click="goToNextChannelKeyframe('opacity')"
            >
              <component :is="IconComponents.NEXT_KEYFRAME" size="11px" />
            </button>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { useAppI18n } from '@/core/composables/useI18n'
import { useUnifiedStore } from '@/core/unifiedStore'
import { useUnifiedKeyframeTransformControls } from '@/core/composables'
import { IconComponents } from '@/constants/iconComponents'
import type { UnifiedTimelineItemData } from '@/core/timelineitem/type'
import NumberInput from '@/components/base/NumberInput.vue'
import SliderInput from '@/components/base/SliderInput.vue'

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
  scaleX,
  scaleY,
  rotation,
  opacity,
  proportionalScale,
  uniformScale,
  elementWidth,
  elementHeight,
  toggleProportionalScale,

  // 延迟更新方法（用于 SliderInput）
  updateUniformScaleDeferred,
  setScaleXDeferred,
  setScaleYDeferred,
  setRotationDeferred,
  setOpacityDeferred,
  commitDeferredUpdates,

  // 直接更新方法（用于 NumberInput）
  setTransformXDirectly,
  setTransformYDirectly,
  setScaleXDirectly,
  setScaleYDirectly,
  setRotationDirectly,
  setOpacityDirectly,
  updateUniformScaleDirectly,

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

const layoutButtonState = computed(() => getChannelButtonState('layout'))
const rotationButtonState = computed(() => getChannelButtonState('rotation'))
const opacityButtonState = computed(() => getChannelButtonState('opacity'))

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

// 适应画布
const handleFitToCanvas = () => {
  if (elementWidth.value <= 0 || elementHeight.value <= 0) {
    console.warn('无法计算缩放：元素尺寸无效', { 
      elementWidth: elementWidth.value, 
      elementHeight: elementHeight.value 
    })
    return
  }
  
  const canvasWidth = unifiedStore.videoResolution.width
  const canvasHeight = unifiedStore.videoResolution.height
  const scale = Math.min(canvasWidth / elementWidth.value, canvasHeight / elementHeight.value)
  
  console.log(
    `适应画布：元素尺寸 ${elementWidth.value}x${elementHeight.value}, 画布尺寸 ${canvasWidth}x${canvasHeight}, 缩放比例 ${scale}`,
  )

  updateUniformScaleDirectly(scale)
}

// 填满画布
const handleFillCanvas = () => {
  if (elementWidth.value <= 0 || elementHeight.value <= 0) {
    console.warn('无法计算缩放：元素尺寸无效', { 
      elementWidth: elementWidth.value, 
      elementHeight: elementHeight.value 
    })
    return
  }
  
  const canvasWidth = unifiedStore.videoResolution.width
  const canvasHeight = unifiedStore.videoResolution.height
  const scale = Math.max(canvasWidth / elementWidth.value, canvasHeight / elementHeight.value)
  
  console.log(
    `填满画布：元素尺寸 ${elementWidth.value}x${elementHeight.value}, 画布尺寸 ${canvasWidth}x${canvasHeight}, 缩放比例 ${scale}`,
  )

  updateUniformScaleDirectly(scale)
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

.scale-controls {
  display: flex;
  align-items: center;
  gap: var(--spacing-xs);
  flex: 1;
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

.keyframe-nav-group {
  display: flex;
  align-items: center;
  gap: 0;
  margin-left: auto;
  flex: 0 0 auto;
}

.keyframe-nav-btn {
  width: 12px;
  height: 22px;
  border-radius: 0;
  border: none;
  background: transparent;
  color: var(--color-text-secondary);
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 0;
  transition: all var(--transition-fast);
  flex: 0 0 auto;
}

.keyframe-nav-group > .property-keyframe-btn {
  border-radius: var(--border-radius-small);
}

.keyframe-nav-btn:hover:not(:disabled) {
  background: transparent;
  color: var(--color-text-primary);
}

.keyframe-nav-btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
  background: transparent;
  color: var(--color-text-muted);
}

.property-keyframe-btn {
  width: 22px;
  height: 22px;
  border-radius: var(--border-radius-small);
  border: 1px solid var(--color-border-secondary);
  background: var(--color-bg-active);
  color: var(--color-text-secondary);
  cursor: pointer;
  font-size: 12px;
  line-height: 1;
  display: inline-flex;
  align-items: center;
  justify-content: center;
}

.property-keyframe-btn.state-on-keyframe {
  color: #5ba6ff;
  border-color: #5ba6ff;
}

.property-keyframe-btn.state-between-keyframes {
  color: #d9a441;
  border-color: #d9a441;
}

.property-keyframe-btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
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
