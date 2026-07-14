<template>
  <!-- 编辑项目对话框 -->
  <UniversalModal
    :show="show"
    :title="t('project.edit')"
    @close="handleClose"
    @confirm="saveProject"
    @cancel="handleClose"
    :confirm-disabled="!form.name.trim() || isSaving"
    :loading="isSaving"
    :confirm-text="isSaving ? t('common.saving') + '...' : t('common.save')"
    :cancel-text="t('common.cancel')"
  >
    <div class="modal-form-fields">
      <ModalFormField :label="t('common.name')" input-id="project-name">
        <input
          id="project-name"
          v-model="form.name"
          type="text"
          :placeholder="t('project.namePlaceholder', '请输入项目名称')"
          maxlength="100"
          @keydown.enter="saveProject"
        />
      </ModalFormField>
      <ModalFormField :label="t('common.description')" input-id="project-description">
        <textarea
          id="project-description"
          v-model="form.description"
          :placeholder="t('project.descriptionPlaceholder', '请输入项目描述（可选）')"
          rows="4"
          maxlength="500"
        ></textarea>
      </ModalFormField>
    </div>
  </UniversalModal>
</template>

<script setup lang="ts">
import { ref, watch } from 'vue'
import UniversalModal from './UniversalModal.vue'
import ModalFormField from '@/components/base/ModalFormField.vue'
import { useAppI18n } from '@/core/composables/useI18n'
import type { UnifiedProjectConfig } from '@/core/project/types'

const { t } = useAppI18n()

interface Props {
  show: boolean
  project: UnifiedProjectConfig | null
  isSaving?: boolean
}

interface Emits {
  (e: 'close'): void
  (e: 'save', data: { name: string; description: string }): void
}

const props = withDefaults(defineProps<Props>(), {
  isSaving: false,
})

const emit = defineEmits<Emits>()

// 表单数据
const form = ref({
  name: '',
  description: '',
})

// 监听项目变化，更新表单数据
watch(
  () => props.project,
  (newProject) => {
    if (newProject) {
      form.value.name = newProject.name
      form.value.description = newProject.description || ''
    }
  },
  { immediate: true },
)

// 监听显示状态，重置表单
watch(
  () => props.show,
  (newShow) => {
    if (newShow && props.project) {
      form.value.name = props.project.name
      form.value.description = props.project.description || ''
    }
  },
)

// 处理关闭
function handleClose() {
  emit('close')
}

// 保存项目
function saveProject() {
  if (!form.value.name.trim() || props.isSaving) {
    return
  }

  emit('save', {
    name: form.value.name.trim(),
    description: form.value.description.trim(),
  })
}
</script>

<style scoped>
.modal-form-fields {
  display: flex;
  flex-direction: column;
  gap: var(--spacing-xxl);
}
</style>
