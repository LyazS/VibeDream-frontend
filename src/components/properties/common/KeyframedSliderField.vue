<template>
  <div class="property-item">
    <label :class="labelClass">{{ label }}</label>
    <div class="slider-number-controls">
      <SliderInput
        :model-value="value"
        :disabled="disabled"
        :min="min"
        :max="max"
        :step="step"
        :slider-class="sliderClass"
        @input="(nextValue) => $emit('slider-input', nextValue)"
        @change="$emit('slider-change')"
      />
      <NumberInput
        :model-value="value"
        :disabled="disabled"
        :min="min"
        :max="max"
        :step="step"
        :precision="precision"
        :show-controls="false"
        :placeholder="placeholder"
        input-class="scale-input"
        @change="(nextValue) => $emit('number-change', nextValue)"
      />
      <KeyframeNavButtons
        :state="state"
        :tooltip="tooltip"
        :disabled="disabled"
        :has-previous="hasPrevious"
        :has-next="hasNext"
        @previous="$emit('previous')"
        @toggle="$emit('toggle')"
        @next="$emit('next')"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import NumberInput from '@/components/base/NumberInput.vue'
import SliderInput from '@/components/base/SliderInput.vue'
import KeyframeNavButtons from '@/components/properties/common/KeyframeNavButtons.vue'

const props = withDefaults(defineProps<{
  label: string
  state: string
  tooltip: string
  disabled: boolean
  hasPrevious: boolean
  hasNext: boolean
  value: number
  min: number
  max: number
  step: number
  precision: number
  sliderClass?: string
  placeholder?: string
}>(), {
  sliderClass: undefined,
  placeholder: undefined,
})

defineEmits<{
  (e: 'slider-input', value: number): void
  (e: 'slider-change'): void
  (e: 'number-change', value: number): void
  (e: 'previous'): void
  (e: 'toggle'): void
  (e: 'next'): void
}>()

const labelClass = computed(() => ({
  'animated-property-label': props.state !== 'none',
  'animated-property-label--on-keyframe': props.state === 'on-keyframe',
  'animated-property-label--between-keyframes': props.state === 'between-keyframes',
}))
</script>

<style scoped>
.slider-number-controls {
  display: flex;
  align-items: center;
  gap: var(--spacing-xs);
  flex: 1;
  min-width: 0;
  container-type: inline-size;
}

@container (max-width: 184px) {
  .slider-number-controls :deep(.slider-container) {
    display: none;
  }
}

.animated-property-label--on-keyframe {
  color: #5ba6ff;
}

.animated-property-label--between-keyframes {
  color: #d9a441;
}

:deep(.scale-input) {
  width: 120px;
}
</style>
