<template>
  <div class="property-item">
    <label :class="labelClass">{{ label }}</label>
    <div class="rotation-number-controls">
      <button
        ref="knobRef"
        class="rotation-knob"
        :class="{ 'is-dragging': isDragging }"
        type="button"
        :disabled="disabled"
        :aria-label="t('properties.visual.rotationKnobLabel', { label, value: formattedValue })"
        :title="t('properties.visual.rotationKnobTooltip')"
        @pointerdown="handlePointerDown"
        @dblclick="resetRotation"
        @keydown="handleKeyDown"
      >
        <span class="rotation-knob__ticks" aria-hidden="true" />
        <span class="rotation-knob__indicator" :style="indicatorStyle" aria-hidden="true" />
      </button>
      <NumberInput
        :model-value="value"
        :disabled="disabled"
        :step="step"
        :precision="precision"
        :show-controls="false"
        unit="°"
        input-class="rotation-input"
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
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import NumberInput from '@/components/base/NumberInput.vue'
import KeyframeNavButtons from '@/components/properties/common/KeyframeNavButtons.vue'
import { useAppI18n } from '@/core/composables'

const props = defineProps<{
  label: string
  state: string
  tooltip: string
  disabled: boolean
  hasPrevious: boolean
  hasNext: boolean
  value: number
  step: number
  precision: number
}>()

const emit = defineEmits<{
  (e: 'rotation-input', value: number): void
  (e: 'rotation-change', value: number): void
  (e: 'number-change', value: number): void
  (e: 'previous'): void
  (e: 'toggle'): void
  (e: 'next'): void
}>()

const { t } = useAppI18n()

const knobRef = ref<HTMLButtonElement>()
const isDragging = ref(false)
const dragValue = ref(props.value)
const previousPointerAngle = ref(0)

watch(
  () => props.value,
  (value) => {
    if (!isDragging.value) dragValue.value = value
  },
)

const labelClass = computed(() => ({
  'animated-property-label': props.state !== 'none',
  'animated-property-label--on-keyframe': props.state === 'on-keyframe',
  'animated-property-label--between-keyframes': props.state === 'between-keyframes',
}))

const formattedValue = computed(() => dragValue.value.toFixed(props.precision))
// Keep the unwrapped value so 180 -> 181 never becomes 180 -> -179 for CSS interpolation.
const indicatorStyle = computed(() => ({ transform: `rotate(${dragValue.value}deg)` }))

function getPointerAngle(event: PointerEvent): number {
  const rect = knobRef.value?.getBoundingClientRect()
  if (!rect) return 0
  return Math.atan2(event.clientY - (rect.top + rect.height / 2), event.clientX - (rect.left + rect.width / 2))
}

function getShortestAngleDelta(current: number, previous: number): number {
  let delta = ((current - previous) * 180) / Math.PI
  if (delta > 180) delta -= 360
  if (delta < -180) delta += 360
  return delta
}

function emitPreview(value: number) {
  dragValue.value = value
  emit('rotation-input', value)
}

function handlePointerDown(event: PointerEvent) {
  if (props.disabled || event.button !== 0 || !knobRef.value) return
  event.preventDefault()
  knobRef.value.setPointerCapture(event.pointerId)
  isDragging.value = true
  dragValue.value = props.value
  previousPointerAngle.value = getPointerAngle(event)
  window.addEventListener('pointermove', handlePointerMove)
  window.addEventListener('pointerup', handlePointerEnd)
  window.addEventListener('pointercancel', handlePointerEnd)
}

function handlePointerMove(event: PointerEvent) {
  if (!isDragging.value) return
  const currentPointerAngle = getPointerAngle(event)
  let nextValue = dragValue.value + getShortestAngleDelta(currentPointerAngle, previousPointerAngle.value)
  if (event.altKey) nextValue = dragValue.value + (nextValue - dragValue.value) * 0.2
  previousPointerAngle.value = currentPointerAngle
  emitPreview(Number(nextValue.toFixed(props.precision)))
}

function handlePointerEnd(event: PointerEvent) {
  if (!isDragging.value) return
  isDragging.value = false
  removePointerListeners()
  if (knobRef.value?.hasPointerCapture(event.pointerId)) {
    knobRef.value.releasePointerCapture(event.pointerId)
  }
  emit('rotation-change', dragValue.value)
}

function removePointerListeners() {
  window.removeEventListener('pointermove', handlePointerMove)
  window.removeEventListener('pointerup', handlePointerEnd)
  window.removeEventListener('pointercancel', handlePointerEnd)
}

onBeforeUnmount(removePointerListeners)

function resetRotation() {
  if (props.disabled) return
  dragValue.value = 0
  emit('number-change', 0)
}

function handleKeyDown(event: KeyboardEvent) {
  if (props.disabled) return
  const increment = props.step
  let nextValue: number | null = null
  if (event.key === 'ArrowUp' || event.key === 'ArrowRight') nextValue = props.value + increment
  if (event.key === 'ArrowDown' || event.key === 'ArrowLeft') nextValue = props.value - increment
  if (event.key === 'Home') nextValue = 0
  if (nextValue === null) return
  event.preventDefault()
  emitPreview(Number(nextValue.toFixed(props.precision)))
  emit('rotation-change', nextValue)
}
</script>

<style scoped>
.rotation-number-controls {
  display: flex;
  align-items: center;
  gap: var(--spacing-xs);
  flex: 1;
  min-width: 0;
}

.rotation-knob {
  --rotation-knob-size: 24px;
  position: relative;
  width: var(--rotation-knob-size);
  height: var(--rotation-knob-size);
  flex: 0 0 var(--rotation-knob-size);
  padding: 0;
  border: 0;
  border-radius: 50%;
  background: var(--color-bg-secondary);
  box-shadow: inset 0 0 0 1px var(--color-bg-hover);
  color: var(--color-text-primary);
  cursor: grab;
  touch-action: none;
  transition-property: background-color, box-shadow, transform;
  transition-duration: var(--transition-fast);
  transition-timing-function: ease-out;
}

.rotation-knob::before {
  position: absolute;
  inset: -8px;
  content: '';
}

.rotation-knob:hover:not(:disabled),
.rotation-knob:focus-visible {
  background: var(--color-bg-hover);
  outline: none;
}

.rotation-knob:focus-visible {
  box-shadow:
    0 1px 2px rgba(0, 0, 0, 0.45),
    0 4px 10px rgba(0, 0, 0, 0.35);
}

.rotation-knob:active:not(:disabled) {
  cursor: grabbing;
}

.rotation-knob.is-dragging {
  background: var(--color-bg-hover);
  box-shadow:
    0 1px 2px rgba(0, 0, 0, 0.45),
    0 4px 10px rgba(0, 0, 0, 0.35);
  transform: translateY(-1px);
}

.rotation-knob:disabled {
  cursor: not-allowed;
  opacity: 0.4;
}

.rotation-knob__ticks {
  position: absolute;
  inset: 3px;
  border-radius: 50%;
  background: repeating-conic-gradient(from -90deg, var(--color-text-muted) 0deg 1deg, transparent 1deg 90deg);
  opacity: 0.75;
}

.rotation-knob__indicator {
  position: absolute;
  top: 3px;
  left: calc(50% - 1px);
  width: 2px;
  height: 9px;
  border-radius: 1px;
  background: currentColor;
  transform-origin: 1px 9px;
}

.animated-property-label--on-keyframe {
  color: #5ba6ff;
}

.animated-property-label--between-keyframes {
  color: #d9a441;
}

:deep(.rotation-input) {
  width: 78px;
}
</style>
