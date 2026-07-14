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
    <ModalFormField :label="t('media.folderNameLabel')" input-id="folder-name">
      <input
        id="folder-name"
        ref="inputRef"
        v-model="folderName"
        type="text"
        :placeholder="t('media.folderNamePlaceholder')"
        @keyup.enter="handleConfirm"
      />
    </ModalFormField>
  </UniversalModal>
</template>

<script setup lang="ts">
import { ref, watch, nextTick } from 'vue'
import UniversalModal from './UniversalModal.vue'
import ModalFormField from '@/components/base/ModalFormField.vue'
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
