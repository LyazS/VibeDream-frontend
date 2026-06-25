<template>
  <!-- 创建文件夹对话框 -->
  <UniversalModal
    :show="show"
    :title="t('media.newFolder')"
    :confirm-text="t('media.confirm')"
    :cancel-text="t('media.cancel')"
    :confirm-disabled="!folderName.trim()"
    @close="handleClose"
    @confirm="handleConfirm"
    @cancel="handleClose"
  >
    <div class="form-group">
      <label>{{ t('media.folderNameLabel') }}</label>
      <input
        ref="inputRef"
        v-model="folderName"
        type="text"
        class="form-input"
        :placeholder="t('media.folderNamePlaceholder')"
        @keyup.enter="handleConfirm"
      />
    </div>
  </UniversalModal>
</template>

<script setup lang="ts">
import { ref, watch, nextTick } from 'vue'
import UniversalModal from './UniversalModal.vue'
import { useAppI18n } from '@/core/composables/useI18n'

const { t } = useAppI18n()

interface Props {
  show: boolean
}

interface Emits {
  (e: 'close'): void
  (e: 'confirm', folderName: string): void
}

const props = defineProps<Props>()
const emit = defineEmits<Emits>()

const folderName = ref('')
const inputRef = ref<HTMLInputElement>()

// 处理关闭
function handleClose() {
  folderName.value = ''
  emit('close')
}

// 处理确认
function handleConfirm() {
  if (!folderName.value.trim()) {
    return
  }

  emit('confirm', folderName.value.trim())
}

// 监听显示状态，自动聚焦输入框
watch(
  () => props.show,
  (newShow) => {
    if (newShow) {
      nextTick(() => {
        inputRef.value?.focus()
      })
    }
  },
)
</script>

<style scoped>
.form-group {
  margin-bottom: 0;
}

.form-group label {
  display: block;
  margin-bottom: 0.5rem;
  font-size: 0.875rem;
  font-weight: 500;
  color: var(--color-text-primary);
}

.form-input {
  width: 100%;
  padding: 0.75rem;
  background: var(--color-bg-primary);
  border: 1px solid transparent;
  border-radius: var(--border-radius-medium);
  color: var(--color-text-primary);
  font-size: 0.875rem;
  transition: all 0.2s ease;
  box-sizing: border-box;
}

.form-input:focus {
  outline: none;
  border: 1px solid white;
}
</style>
