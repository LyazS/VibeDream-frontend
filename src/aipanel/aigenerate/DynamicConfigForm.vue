<template>
  <div class="dynamic-config-form">
    <div
      v-for="(fieldConfig, index) in uiConfig"
      :key="index"
      class="form-field"
    >
      <NumberField
        v-if="fieldConfig.type === 'number-input'"
        :config="fieldConfig"
        :modelValue="getFieldValue(fieldConfig.path)"
        :locale="locale"
        :error="getFieldError(fieldConfig.path)"
        @update:modelValue="handleFieldChange(fieldConfig.path, $event)"
      />
      <TextareaField
        v-else-if="fieldConfig.type === 'textarea-input'"
        :config="fieldConfig"
        :modelValue="getFieldValue(fieldConfig.path)"
        :locale="locale"
        :error="getFieldError(fieldConfig.path)"
        @update:modelValue="handleFieldChange(fieldConfig.path, $event)"
      />
      <SelectField
        v-else-if="fieldConfig.type === 'select-input'"
        :config="fieldConfig"
        :modelValue="getFieldValue(fieldConfig.path)"
        :locale="locale"
        :error="getFieldError(fieldConfig.path)"
        @update:modelValue="handleFieldChange(fieldConfig.path, $event)"
      />
      <FileInputField
        v-else-if="fieldConfig.type === 'file-input'"
        :config="fieldConfig"
        :modelValue="getFieldValue(fieldConfig.path)"
        :locale="locale"
        :error="getFieldError(fieldConfig.path)"
        @update:modelValue="handleFieldChange(fieldConfig.path, $event)"
      />
      <div v-else class="field-error">
        未知字段类型
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { cloneDeep } from 'lodash'
import NumberField from './fields/NumberField.vue'
import TextareaField from './fields/TextareaField.vue'
import SelectField from './fields/SelectField.vue'
import FileInputField from './fields/FileInputField.vue'
import type { UIConfig, FieldValidationError } from '@/aipanel/aigenerate/types'
import { getValueByPathWithWrapper, setValueByPathWithWrapper } from './utils/pathUtils'

interface Props {
  // UI配置数组（单向绑定，只读）
  uiConfig: UIConfig[]
  // AI配置对象（双向绑定，可修改）
  aiConfig: Record<string, unknown>
  locale: 'zh' | 'en'
  // 验证错误映射（可选）
  validationErrors?: Map<string, FieldValidationError>
}

interface Emits {
  // aiConfig 双向绑定的更新事件
  (e: 'update:aiConfig', value: Record<string, unknown>): void
}

const props = defineProps<Props>()
const emit = defineEmits<Emits>()

// 规范化路径 - 移除 'aiConfig.' 前缀（如果存在）
const normalizePath = (path: string): string => {
  return path.startsWith('aiConfig.') ? path.substring(9) : path
}

// 获取字段值 - 从包装器结构中读取 value
const getFieldValue = (path: string) => {
  const normalizedPath = normalizePath(path)
  return getValueByPathWithWrapper(props.aiConfig, normalizedPath)
}

// 获取字段的验证错误
const getFieldError = (path: string): FieldValidationError | undefined => {
  return props.validationErrors?.get(path)
}

// 处理字段变化 - 设置到包装器结构的 value
const handleFieldChange = (path: string, value: unknown) => {
  const normalizedPath = normalizePath(path)
  // 深拷贝 aiConfig 避免直接修改 props
  const newConfig = cloneDeep(props.aiConfig)
  setValueByPathWithWrapper(newConfig, normalizedPath, value)
  
  // 触发双向绑定更新事件
  emit('update:aiConfig', newConfig)
}
</script>

<style scoped>
.dynamic-config-form {
  display: flex;
  flex-direction: column;
  gap: var(--spacing-md);
}

.form-field {
  width: 100%;
}

.field-error {
  padding: var(--spacing-sm);
  background: var(--color-error-bg);
  color: var(--color-error);
  border-radius: var(--border-radius-small);
  font-size: var(--font-size-sm);
}
</style>
