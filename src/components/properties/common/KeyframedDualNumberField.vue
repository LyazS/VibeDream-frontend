<template>
  <div class="property-item">
    <label :class="labelClass">{{ label }}</label>
    <div class="position-controls">
      <div class="position-input-group">
        <span class="position-label">{{ firstLabel }}</span>
        <NumberInput
          :model-value="firstValue"
          :disabled="disabled"
          :min="firstMin"
          :max="firstMax"
          :step="step"
          :precision="precision"
          :placeholder="firstPlaceholder"
          @change="(value) => $emit('first-change', value)"
        />
      </div>
      <div class="position-input-group">
        <span class="position-label">{{ secondLabel }}</span>
        <NumberInput
          :model-value="secondValue"
          :disabled="disabled"
          :min="secondMin"
          :max="secondMax"
          :step="step"
          :precision="precision"
          :placeholder="secondPlaceholder"
          @change="(value) => $emit('second-change', value)"
        />
      </div>
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
import KeyframeNavButtons from '@/components/properties/common/KeyframeNavButtons.vue'

const props = withDefaults(defineProps<{
  label: string
  state: string
  tooltip: string
  disabled: boolean
  hasPrevious: boolean
  hasNext: boolean
  firstLabel: string
  secondLabel: string
  firstValue: number
  secondValue: number
  firstMin: number
  firstMax: number
  secondMin: number
  secondMax: number
  step: number
  precision: number
  firstPlaceholder?: string
  secondPlaceholder?: string
}>(), {
  firstPlaceholder: undefined,
  secondPlaceholder: undefined,
})

defineEmits<{
  (e: 'first-change', value: number): void
  (e: 'second-change', value: number): void
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
.position-controls {
  display: flex;
  gap: var(--spacing-xs);
  align-items: center;
  flex: 1;
  min-width: 0;
}

.position-input-group {
  display: flex;
  align-items: center;
  gap: var(--spacing-xs);
  flex: 1;
  min-width: 0;
}

.position-label {
  color: var(--color-text-secondary);
  font-size: var(--font-size-sm);
  min-width: 12px;
}

.animated-property-label--on-keyframe {
  color: #5ba6ff;
}

.animated-property-label--between-keyframes {
  color: #d9a441;
}
</style>
