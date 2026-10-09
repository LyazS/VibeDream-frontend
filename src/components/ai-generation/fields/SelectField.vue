<template>
  <div class="select-field">
    <label class="field-label">
      {{ config.label[locale] }}
      <span v-if="isRequired" class="required-mark">*</span>
    </label>
    <select
      :value="modelValue"
      @change="handleChange"
      :class="fieldClasses"
    >
      <option
        v-for="option in config.options"
        :key="option.value"
        :value="option.value"
      >
        {{ option.label[locale] }}
      </option>
    </select>
    <!-- 错误提示 -->
    <div v-if="hasError" class="error-message">
      <component :is="IconComponents.WARNING" size="14px" />
      <span>{{ errorMessage }}</span>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import type { SelectInputConfig, FieldValidationError } from '@/core/datasource/providers/ai-generation/types'
import { IconComponents } from '@/constants/iconComponents'

interface Props {
  config: SelectInputConfig
  modelValue: string | number
  locale: 'zh' | 'en'
  error?: FieldValidationError  // 新增：验证错误
}

interface Emits {
  (e: 'update:modelValue', value: string | number): void
}

const props = defineProps<Props>()
const emit = defineEmits<Emits>()

// 是否显示必填标记
const isRequired = computed(() => props.config.required)

// 是否有错误
const hasError = computed(() => !!props.error)

// 错误消息
const errorMessage = computed(() => {
  if (!props.error) return ''
  return props.error.message[props.locale]
})

// 字段样式类
const fieldClasses = computed(() => ({
  'field-select': true,
  'field-error': hasError.value
}))

const handleChange = (event: Event) => {
  const target = event.target as HTMLSelectElement
  const selectedOption = props.config.options.find(opt => opt.value === target.value)
  
  // 如果找到的选项值是数字类型，则转换为数字，否则保持字符串
  if (selectedOption !== undefined && typeof selectedOption.value === 'number') {
    emit('update:modelValue', Number(target.value))
  } else {
    emit('update:modelValue', target.value)
  }
}
</script>

<style scoped>
.select-field {
  display: flex;
  flex-direction: column;
  gap: var(--spacing-xs);
}

.field-label {
  font-size: var(--font-size-sm);
  color: var(--color-text-secondary);
  font-weight: 500;
}

.field-select {
  width: 100%;
  padding: var(--spacing-sm);
  background: var(--color-bg-quaternary);
  border: 1px solid var(--color-border-secondary);
  border-radius: var(--border-radius-small);
  color: var(--color-text-primary);
  font-size: var(--font-size-sm);
  cursor: pointer;
}

.field-select:focus {
  outline: none;
  border-color: var(--color-accent-primary);
}

/* 必填标记 */
.required-mark {
  color: var(--color-error);
  margin-left: 2px;
}

/* 错误状态的选择框 */
.field-select.field-error {
  border-color: var(--color-error);
  background: var(--color-error-bg);
}

.field-select.field-error:focus {
  border-color: var(--color-error);
  box-shadow: 0 0 0 2px var(--color-error-bg);
}

/* 错误消息 */
.error-message {
  display: flex;
  align-items: center;
  gap: var(--spacing-xs);
  margin-top: var(--spacing-xs);
  font-size: var(--font-size-xs);
  color: var(--color-error);
}
</style>