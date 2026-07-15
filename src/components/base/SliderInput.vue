<template>
  <div class="slider-container" :class="containerClass">
    <input
      :value="modelValue"
      @input="handleInput"
      @change="handleChange"
      type="range"
      :min="min"
      :max="max"
      :step="step"
      :disabled="disabled"
      :class="['slider', sliderClass]"
      :style="sliderStyle"
    />
    <!-- 分段竖线（如果提供） -->
    <div v-if="segments && segments.length > 0" class="slider-dividers">
      <div
        v-for="(segment, index) in segments"
        :key="index"
        class="slider-divider"
        :style="{ left: segment.position + '%' }"
        :title="segment.label"
      ></div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'

interface SliderSegment {
  /** 分段位置百分比 (0-100) */
  position: number
  /** 分段标签 */
  label?: string
}

interface Props {
  /** 当前值 */
  modelValue: number
  /** 最小值 */
  min?: number
  /** 最大值 */
  max?: number
  /** 步长 */
  step?: number
  /** 是否禁用 */
  disabled?: boolean
  /** 容器额外CSS类 */
  containerClass?: string
  /** 滑块额外CSS类 */
  sliderClass?: string
  /** 滑块自定义样式 */
  sliderStyle?: Record<string, string | number>
  /** 分段标记 */
  segments?: SliderSegment[]
  /** 是否实时更新（input事件），否则只在拖拽结束时更新 */
  realtime?: boolean
}

interface Emits {
  (e: 'update:modelValue', value: number): void
  (e: 'change', value: number): void
  (e: 'input', value: number): void
}

const props = withDefaults(defineProps<Props>(), {
  min: 0,
  max: 100,
  step: 1,
  disabled: false,
  containerClass: '',
  sliderClass: '',
  sliderStyle: () => ({}),
  segments: () => [],
  realtime: true,
})

const emit = defineEmits<Emits>()

// 处理输入事件
const handleInput = (event: Event) => {
  const input = event.target as HTMLInputElement
  const value = parseFloat(input.value)

  emit('input', value)

  if (props.realtime) {
    emit('update:modelValue', value)
  }
}

// 处理变更事件（拖拽结束）
const handleChange = (event: Event) => {
  const input = event.target as HTMLInputElement
  const value = parseFloat(input.value)

  emit('change', value)

  if (!props.realtime) {
    emit('update:modelValue', value)
  }
}
</script>

<style scoped>
/* 滑块容器 */
.slider-container {
  position: relative;
  display: flex;
  align-items: center;
  flex: 1;
  min-width: 0;
}

/* 滑块基础样式 */
.slider {
  flex: 1;
  min-width: 0;
  height: 4px;
  background: var(--color-bg-quaternary);
  border-radius: 2px;
  outline: none;
  -webkit-appearance: none;
  appearance: none;
  cursor: pointer;
  transition: background-color var(--transition-fast);
  position: relative;
  z-index: 2;
}

.slider:disabled {
  cursor: not-allowed;
  opacity: 0.5;
}

/* WebKit 滑块样式 */
.slider::-webkit-slider-thumb {
  -webkit-appearance: none;
  width: 12px;
  height: 12px;
  background: var(--color-accent-secondary);
  border-radius: 50%;
  cursor: pointer;
  transition: all var(--transition-fast);
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.3);
}

.slider::-webkit-slider-thumb:hover {
  background: var(--color-accent-primary);
  transform: scale(1.1);
}

.slider:disabled::-webkit-slider-thumb {
  cursor: not-allowed;
  background: var(--color-text-muted);
}

/* Firefox 滑块样式 */
.slider::-moz-range-thumb {
  width: 12px;
  height: 12px;
  background: var(--color-accent-secondary);
  border-radius: 50%;
  cursor: pointer;
  border: none;
  transition: all var(--transition-fast);
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.3);
}

.slider::-moz-range-thumb:hover {
  background: var(--color-accent-primary);
  transform: scale(1.1);
}

.slider:disabled::-moz-range-thumb {
  cursor: not-allowed;
  background: var(--color-text-muted);
}

/* Firefox 轨道样式 */
.slider::-moz-range-track {
  height: 4px;
  background: var(--color-bg-quaternary);
  border-radius: 2px;
  border: none;
}

/* 分段竖线 */
.slider-dividers {
  position: absolute;
  top: 50%;
  left: 0;
  right: 0;
  height: 12px;
  transform: translateY(-50%);
  pointer-events: none;
  z-index: 1;
}

.slider-divider {
  position: absolute;
  width: 1px;
  height: 100%;
  background: var(--color-border-secondary);
  transform: translateX(-50%);
}

/* 特殊滑块样式变体 */
.slider.volume-slider {
  background: linear-gradient(
    to right,
    var(--color-bg-quaternary) 0%,
    var(--color-accent-secondary) 100%
  );
}

.slider.speed-slider {
  background: var(--color-bg-quaternary);
}

.slider.rotation-slider {
  background: linear-gradient(
    to right,
    var(--color-accent-warning) 0%,
    var(--color-bg-quaternary) 50%,
    var(--color-accent-warning) 100%
  );
}

.slider.opacity-slider {
  background: linear-gradient(to right, transparent 0%, var(--color-text-primary) 100%);
  border: 1px solid var(--color-border-secondary);
}

/* 分段速度滑块特殊样式 */
.slider.segmented-speed-slider {
  background: var(--color-bg-quaternary);
}
</style>
