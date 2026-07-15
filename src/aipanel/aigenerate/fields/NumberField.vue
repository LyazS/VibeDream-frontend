<template>
  <div class="number-field-wrapper">
    <div class="number-field">
      <label class="field-label">
        {{ config.label[locale] }}
        <span v-if="isRequired" class="required-mark">*</span>
      </label>
      <SliderInput
        v-if="showSlider"
        :modelValue="modelValue"
        :min="config.min"
        :max="config.max"
        :step="config.step"
        :realtime="true"
        @update:modelValue="handleValueChange"
      />
      <NumberInput
        :modelValue="modelValue"
        :min="config.min"
        :max="config.max"
        :step="config.step"
        :precision="config.precision"
        :showControls="true"
        @update:modelValue="handleValueChange"
      />
    </div>
    <!-- 错误提示 -->
    <div v-if="hasError" class="error-message">
      <component :is="IconComponents.WARNING" size="14px" />
      <span>{{ errorMessage }}</span>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import NumberInput from '@/components/base/NumberInput.vue'
import SliderInput from '@/components/base/SliderInput.vue'
import type { NumberInputConfig, FieldValidationError } from '@/aipanel/aigenerate/types'
import { IconComponents } from '@/constants/iconComponents'

interface Props {
  config: NumberInputConfig
  modelValue: number
  locale: 'zh' | 'en'
  error?: FieldValidationError  // 新增：验证错误
}

interface Emits {
  (e: 'update:modelValue', value: number): void
}

const props = defineProps<Props>()
const emit = defineEmits<Emits>()

// 是否显示滑块，默认为 true
const showSlider = computed(() => props.config.showSlider !== false)

// 是否显示必填标记
const isRequired = computed(() => props.config.required)

// 是否有错误
const hasError = computed(() => !!props.error)

// 错误消息
const errorMessage = computed(() => {
  if (!props.error) return ''
  return props.error.message[props.locale]
})

const handleValueChange = (value: number) => {
  emit('update:modelValue', value)
}
</script>

<style scoped>
.number-field-wrapper {
  display: flex;
  flex-direction: column;
  gap: var(--spacing-xs);
}

.number-field {
  display: flex;
  align-items: center;
  gap: var(--spacing-sm);
}

.field-label {
  font-size: var(--font-size-sm);
  color: var(--color-text-secondary);
  font-weight: 500;
  min-width: 80px;
  flex-shrink: 0;
}

/* 必填标记 */
.required-mark {
  color: var(--color-error);
  margin-left: 2px;
}

/* 错误消息 */
.error-message {
  display: flex;
  align-items: center;
  gap: var(--spacing-xs);
  margin-left: 92px; /* 对齐到输入框位置 (80px label + 12px gap) */
  font-size: var(--font-size-xs);
  color: var(--color-error);
}
</style>