<template>
  <div class="number-input-container" :class="{ 'with-controls': showControls }">
    <input
      :value="displayValue"
      @blur="handleConfirm"
      @keyup.enter="handleEnter"
      @input="handleInput"
      type="number"
      :disabled="disabled"
      :step="step"
      :min="min"
      :max="max"
      :placeholder="placeholder"
      :style="inputStyle"
      :class="['number-input', inputClass]"
    />
    <div v-if="showControls" class="number-controls">
      <button
        @click="handleIncrement"
        :disabled="disabled"
        class="number-btn number-btn-up"
        title="Increase value"
        aria-label="Increase value"
      >
        <RiArrowUpSLine class="number-btn-icon" aria-hidden="true" />
      </button>
      <button
        @click="handleDecrement"
        :disabled="disabled"
        class="number-btn number-btn-down"
        title="Decrease value"
        aria-label="Decrease value"
      >
        <RiArrowDownSLine class="number-btn-icon" aria-hidden="true" />
      </button>
    </div>
    <span v-if="unit" class="number-unit">{{ unit }}</span>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import { RiArrowDownSLine, RiArrowUpSLine } from '@remixicon/vue'

interface Props {
  /** 当前值 */
  modelValue: number
  /** 最小值 */
  min?: number
  /** 最大值 */
  max?: number
  /** 步长 */
  step?: number
  /** 小数位数 */
  precision?: number
  /** 是否显示上下控制按钮 */
  showControls?: boolean
  /** 占位符 */
  placeholder?: string
  /** 单位文本 */
  unit?: string
  /** 输入框自定义样式 */
  inputStyle?: Record<string, string | number>
  /** 输入框额外CSS类 */
  inputClass?: string
  /** 是否实时更新（input事件），否则只在确认时更新 */
  realtime?: boolean
  /** 是否禁用输入 */
  disabled?: boolean
}

interface Emits {
  (e: 'update:modelValue', value: number): void
  (e: 'input', value: number): void
  (e: 'change', value: number): void
}

const props = withDefaults(defineProps<Props>(), {
  min: undefined,
  max: undefined,
  step: 1,
  precision: undefined,
  showControls: true,
  placeholder: '',
  unit: '',
  inputStyle: () => ({}),
  inputClass: '',
  realtime: false,
  disabled: false,
})

const emit = defineEmits<Emits>()

// 临时输入值（用于非实时模式）
const tempValue = ref<string>('')
const isEditing = ref(false)

// 显示值
const displayValue = computed(() => {
  if (isEditing.value) {
    return tempValue.value
  }

  // 确保 modelValue 不是 undefined 或 null
  const value = props.modelValue ?? 0

  if (props.precision !== undefined) {
    return value.toFixed(props.precision)
  }

  return value.toString()
})

// 格式化数值
const formatValue = (value: number): number => {
  let formatted = value

  // 应用范围限制
  if (props.min !== undefined) {
    formatted = Math.max(props.min, formatted)
  }
  if (props.max !== undefined) {
    formatted = Math.min(props.max, formatted)
  }

  // 应用精度
  if (props.precision !== undefined) {
    formatted = parseFloat(formatted.toFixed(props.precision))
  }

  return formatted
}

// 处理输入
const handleInput = (event: Event) => {
  const input = event.target as HTMLInputElement
  tempValue.value = input.value
  isEditing.value = true

  if (props.realtime) {
    const value = parseFloat(input.value)
    if (!isNaN(value)) {
      const formatted = formatValue(value)
      emit('input', formatted)
      emit('update:modelValue', formatted)
    }
  }
}

// 处理确认（失焦）
const handleConfirm = (event: Event) => {
  const input = event.target as HTMLInputElement
  const value = parseFloat(input.value)

  isEditing.value = false
  tempValue.value = ''

  if (!isNaN(value)) {
    const formatted = formatValue(value)
    emit('update:modelValue', formatted)
    emit('change', formatted)
  }
}

// 处理回车键
const handleEnter = (event: Event) => {
  const input = event.target as HTMLInputElement
  handleConfirm(event)
  input.blur()
}

// 处理增加
const handleIncrement = () => {
  const currentValue = props.modelValue ?? 0
  const newValue = formatValue(currentValue + props.step)
  emit('update:modelValue', newValue)
  emit('change', newValue)
}

// 处理减少
const handleDecrement = () => {
  const currentValue = props.modelValue ?? 0
  const newValue = formatValue(currentValue - props.step)
  emit('update:modelValue', newValue)
  emit('change', newValue)
}
</script>

<style scoped>
/* NumberInput 组件完整样式 - 从 common.css 迁移 */

/* 数字输入框容器 */
.number-input-container {
  display: flex;
  align-items: center;
  box-sizing: border-box;
  background: var(--color-bg-secondary);
  border: 1px solid var(--color-bg-hover);
  border-radius: var(--border-radius-small);
  overflow: hidden;
  width: 78px;
  height: 24px;
  position: relative;
  transition-property: background-color, border-color, box-shadow, transform;
  transition-duration: var(--transition-fast);
  transition-timing-function: ease-out;
}

.number-input-container:hover {
  background: var(--color-bg-hover);
}

.number-input-container:focus-within {
  background: var(--color-bg-hover);
  box-shadow:
    0 1px 2px rgba(0, 0, 0, 0.45),
    0 4px 10px rgba(0, 0, 0, 0.35);
  transform: translateY(-1px);
}

.number-input-container.with-controls {
  padding-right: 0;
}

/* 数字输入框 */
.number-input-container .number-input {
  background: transparent;
  border: none;
  color: var(--color-text-primary);
  caret-color: var(--color-text-primary);
  font-size: var(--font-size-sm);
  font-variant-numeric: tabular-nums;
  padding: 2px var(--spacing-xs);
  text-align: center;
  flex: 1;
  min-width: 0;
}

.number-input-container .number-input:focus {
  outline: none;
}

.with-controls .number-input {
  border-radius: var(--border-radius-small) 0 0 var(--border-radius-small);
  border-right: none;
}

/* 隐藏默认的数字输入框箭头 */
.number-input::-webkit-outer-spin-button,
.number-input::-webkit-inner-spin-button {
  -webkit-appearance: none;
  margin: 0;
}

.number-input[type='number'] {
  -moz-appearance: textfield;
  appearance: textfield;
}

/* 控制按钮容器 */
.number-input-container .number-controls {
  display: flex;
  flex-direction: column;
  width: 20px;
  flex-shrink: 0;
  border-left: 1px solid rgba(255, 255, 255, 0.1);
}

/* 控制按钮 */
.number-input-container .number-btn {
  background: transparent;
  border: none;
  color: var(--color-text-muted);
  cursor: pointer;
  padding: 0;
  width: 100%;
  height: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  transition-property: background-color, color, transform;
  transition-duration: var(--transition-fast);
  transition-timing-function: ease-out;
  flex: 1;
}

.number-input-container .number-btn:hover {
  background: var(--color-bg-quaternary);
  color: var(--color-text-primary);
}

.number-input-container .number-btn:active {
  background: var(--color-bg-active);
  transform: scale(0.96);
}

.number-input-container .number-btn-icon {
  width: 12px;
  height: 12px;
  pointer-events: none;
}

.number-btn-up {
  border-bottom: 1px solid rgba(255, 255, 255, 0.1);
}

.number-btn-down {
  border-radius: 0;
}

/* 禁用状态样式 */
.number-input:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.number-input-container .number-btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

/* 单位文本 */
.number-input-container .number-unit {
  font-size: var(--font-size-sm);
  color: var(--color-text-hint);
  margin-left: var(--spacing-xs);
  flex-shrink: 0;
  white-space: nowrap;
  align-self: center;
}
</style>
