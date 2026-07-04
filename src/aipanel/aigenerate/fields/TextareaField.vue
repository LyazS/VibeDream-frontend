<template>
  <div class="textarea-field">
    <label class="field-label">
      {{ config.label[locale] }}
      <span v-if="isRequired" class="required-mark">*</span>
    </label>
    <!-- 根据 enableTag 决定使用 TagInput 还是普通的 textarea -->
    <TagInput
      v-if="enableTag"
      :model-value="modelValue"
      @update:model-value="emit('update:modelValue', $event)"
      :available-tags="characterTags"
      :placeholder="getPlaceholder()"
      :max-height="'400px'"
      :min-height="'160px'"
      :class="fieldClasses"
    />
    <textarea
      v-else
      :value="modelValue"
      @input="emit('update:modelValue', ($event.target as HTMLTextAreaElement).value)"
      :placeholder="getPlaceholder()"
      :maxlength="config.maxLength"
      :class="fieldClasses"
      class="plain-textarea"
    />
    <!-- 错误提示 -->
    <div v-if="hasError" class="error-message">
      <component :is="IconComponents.WARNING" size="14px" />
      <span>{{ errorMessage }}</span>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { useUnifiedStore } from '@/core/unifiedStore'
import TagInput from '@/components/base/TagInput.vue'
import type { TagItem } from '@/components/base/TagInput.vue'
import type { TextareaInputConfig, FieldValidationError } from '@/aipanel/aigenerate/types'
import { IconComponents } from '@/constants/iconComponents'

interface Props {
  config: TextareaInputConfig
  modelValue: string
  locale: 'zh' | 'en'
  error?: FieldValidationError
}

interface Emits {
  (e: 'update:modelValue', value: string): void
}

const props = defineProps<Props>()
const emit = defineEmits<Emits>()

const unifiedStore = useUnifiedStore()

// 是否启用标签功能
const enableTag = computed(() => props.config.enableTag ?? false)

// 是否显示必填标记
const isRequired = computed(() => props.config.required)

// 是否有错误
const hasError = computed(() => !!props.error)

// 错误消息
const errorMessage = computed(() => {
  if (!props.error) return ''
  return props.error.message[props.locale]
})

// 计算当前目录下的角色标签
const characterTags = computed<TagItem[]>(() => {
  const currentDir = unifiedStore.currentDir

  if (!currentDir) {
    return []
  }

  return []
})

// 字段样式类
const fieldClasses = computed(() => ({
  'tag-input-wrapper': enableTag.value,
  'plain-textarea': !enableTag.value,
  'field-error': hasError.value
}))

const getPlaceholder = () => {
  // 如果有自定义占位符，使用自定义占位符
  if (props.config.placeholder?.[props.locale]) {
    return props.config.placeholder[props.locale]
  }

  // 根据 enableTag 返回不同的默认占位符
  if (enableTag.value) {
    return props.locale === 'zh'
      ? '在这里输入文本，按 @ 键添加角色标签...'
      : 'Enter text here, press @ to add character tags...'
  } else {
    return props.locale === 'zh'
      ? '在这里输入文本...'
      : 'Enter text here...'
  }
}
</script>

<style scoped>
.textarea-field {
  display: flex;
  flex-direction: column;
  gap: var(--spacing-xs);
}

.field-label {
  font-size: var(--font-size-sm);
  color: var(--color-text-secondary);
  font-weight: 500;
}

/* 必填标记 */
.required-mark {
  color: var(--color-error);
  margin-left: 2px;
}

/* 错误状态 */
:deep(.tag-input-editor.field-error) {
  border-color: var(--color-error);
  background: var(--color-error-bg);
}

:deep(.tag-input-editor.field-error:focus) {
  border-color: var(--color-error);
  box-shadow: 0 0 0 2px var(--color-error-bg);
}

/* 普通 textarea 样式 */
.plain-textarea {
  width: 100%;
  min-height: 160px;
  max-height: 400px;
  padding: 1rem;
  border: 2px solid #374151;
  border-radius: 0.5rem;
  background: #1f2937;
  color: #e5e7eb;
  font-size: 0.875rem;
  line-height: 1.625;
  resize: vertical;
  transition: border-color 0.2s;
  outline: none;
}

.plain-textarea:focus {
  border-color: #60a5fa;
}

.plain-textarea.field-error {
  border-color: var(--color-error);
  background: var(--color-error-bg);
}

.plain-textarea.field-error:focus {
  border-color: var(--color-error);
  box-shadow: 0 0 0 2px var(--color-error-bg);
}

.plain-textarea::placeholder {
  color: #6b7280;
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
