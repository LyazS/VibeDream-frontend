<template>
  <div
    class="filter-drop-zone"
    :class="{
      'filter-drop-zone--active': isDragActive,
      'filter-drop-zone--filled': Boolean(currentAsset),
    }"
    @dragenter="handleDragEnter"
    @dragover="handleDragOver"
    @dragleave="handleDragLeave"
    @drop="handleDrop"
  >
    <template v-if="currentAsset">
      <div class="filter-drop-zone__header">
        <div>
        <div class="filter-drop-zone__title">
          {{ currentAsset.meta?.name.zh || currentAsset.meta?.name.en || currentAsset.templateId }}
        </div>
        <div class="filter-drop-zone__meta">
          {{ currentAsset.status === 'ready' ? t('properties.filter.ready') : currentAsset.status }}
        </div>
      </div>
      <button type="button" class="filter-drop-zone__remove" @click="emit('remove')">
        <component :is="IconComponents.DELETE" size="14px" />
      </button>
    </div>
  </template>

    <template v-else>
      <div class="filter-drop-zone__empty">
        <component :is="getEffectTypeIcon('filter')" size="20px" />
        <span>{{ t('properties.filter.dropHint') }}</span>
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import { IconComponents, getEffectTypeIcon } from '@/constants/iconComponents'
import { useAppI18n } from '@/core/composables/useI18n'
import { effectTemplateRegistry } from '@/core/effect-template/EffectTemplateRegistry'
import { useUnifiedStore } from '@/core/unifiedStore'
import { DropTargetType, type ClipFilterDropTargetInfo } from '@/core/types/drag'

interface Props {
  timelineItemId: string
  effectPackageId?: string
}

const props = defineProps<Props>()
const emit = defineEmits<{
  remove: []
}>()

const unifiedStore = useUnifiedStore()
const { t } = useAppI18n()
const isDragActive = ref(false)

const currentAsset = computed(() => {
  return props.effectPackageId
    ? effectTemplateRegistry.getPackageState(props.effectPackageId)
    : null
})

const targetInfo = computed<ClipFilterDropTargetInfo>(() => ({
  targetType: DropTargetType.CLIP_FILTER_DROPZONE,
  timelineItemId: props.timelineItemId,
}))

function handleDragEnter(event: DragEvent) {
  event.preventDefault()
  event.stopPropagation()
}

function handleDragOver(event: DragEvent) {
  event.preventDefault()
  event.stopPropagation()
  const allowed = unifiedStore.handleDragOver(event, targetInfo.value)
  isDragActive.value = allowed
}

function handleDragLeave(event: DragEvent) {
  event.stopPropagation()
  isDragActive.value = false
}

async function handleDrop(event: DragEvent) {
  event.preventDefault()
  event.stopPropagation()
  const result = await unifiedStore.handleDrop(event, targetInfo.value)
  isDragActive.value = false
  if (!result.success && result.error) {
    unifiedStore.messageError(result.error)
  }
}
</script>

<style scoped>
.filter-drop-zone {
  border: 1px dashed var(--color-border-primary);
  border-radius: var(--border-radius-large);
  background: var(--color-bg-tertiary);
  padding: 14px;
  transition: border-color var(--transition-fast), background-color var(--transition-fast);
}

.filter-drop-zone--active {
  border-color: var(--color-accent-primary);
  background: color-mix(in srgb, var(--color-bg-tertiary) 84%, var(--color-accent-primary) 16%);
}

.filter-drop-zone__empty {
  min-height: 84px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
  color: var(--color-text-secondary);
  text-align: center;
}

.filter-drop-zone__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.filter-drop-zone__title {
  color: var(--color-text-primary);
  font-size: var(--font-size-base);
  font-weight: 600;
}

.filter-drop-zone__meta {
  color: var(--color-text-secondary);
  font-size: var(--font-size-sm);
  margin-top: 4px;
}

.filter-drop-zone__remove {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  padding: 0;
  border: 1px solid var(--color-border-secondary);
  border-radius: var(--border-radius-medium);
  background: transparent;
  color: var(--color-text-secondary);
  cursor: pointer;
}
</style>
