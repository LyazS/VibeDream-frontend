<template>
  <!-- 重命名对话框 -->
  <UniversalModal
    :show="show"
    :title="t('media.rename')"
    :confirm-text="t('media.confirm')"
    :cancel-text="t('media.cancel')"
    :confirm-disabled="!newName.trim()"
    @close="handleClose"
    @confirm="handleConfirm"
    @cancel="handleClose"
  >
    <div class="form-group">
      <label>{{ t('media.newNameLabel') }}</label>
      <input
        ref="inputRef"
        v-model="newName"
        type="text"
        class="form-input"
        :placeholder="t('media.newNamePlaceholder')"
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
  currentName?: string
}

interface Emits {
  (e: 'close'): void
  (e: 'confirm', newName: string): void
}

const props = withDefaults(defineProps<Props>(), {
  currentName: '',
})

const emit = defineEmits<Emits>()

const newName = ref('')
const inputRef = ref<HTMLInputElement>()

// 处理关闭
function handleClose() {
  newName.value = ''
  emit('close')
}

// 处理确认
function handleConfirm() {
  if (!newName.value.trim()) {
    return
  }

  emit('confirm', newName.value.trim())
}

// 监听显示状态，自动聚焦输入框并选中文本
watch(
  () => props.show,
  (newShow) => {
    if (newShow) {
      // 设置当前名称
      newName.value = props.currentName

      nextTick(() => {
        inputRef.value?.focus()
        inputRef.value?.select()
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
