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
    <ModalFormField :label="t('media.newNameLabel')" input-id="new-name">
      <input
        id="new-name"
        ref="inputRef"
        v-model="newName"
        type="text"
        :placeholder="t('media.newNamePlaceholder')"
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
