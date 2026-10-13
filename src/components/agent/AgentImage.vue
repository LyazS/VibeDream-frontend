<template>
  <div class="agent-image">
    <NImage v-if="url" :src="url" :alt="t('common.chat.image')" object-fit="contain" />
    <span v-else-if="error" class="image-error" role="alert">{{ error }}</span>
    <span v-else>{{ t('common.loading') }}</span>
  </div>
</template>

<script setup lang="ts">
import { onBeforeUnmount, ref, watch } from 'vue'
import { NImage } from 'naive-ui'
import { createAgentImagePreview } from '@/core/agent/services/agentImageService'
import { useUnifiedStore } from '@/core/unifiedStore'
import { useAppI18n } from '@/core/composables/useI18n'

const props = defineProps<{ imageId: string }>()
const store = useUnifiedStore()
const { t } = useAppI18n()
const url = ref('')
const error = ref('')
watch(
  () => [props.imageId, store.agentSessionId],
  (_value, _old, onCleanup) => {
    let current = true
    let preview: ReturnType<typeof createAgentImagePreview> | undefined
    url.value = ''
    error.value = ''
    onCleanup(() => {
      current = false
      preview?.dispose()
    })
    void store
      .getAgentImage(props.imageId)
      .then((image) => {
        if (!current) return
        preview = createAgentImagePreview(image.blob)
        url.value = preview.url
      })
      .catch((reason: unknown) => {
        if (current)
          error.value = reason instanceof Error ? reason.message : t('common.unknownError')
      })
  },
  { immediate: true },
)
onBeforeUnmount(() => {
  url.value = ''
})
</script>

<style scoped>
.agent-image {
  width: 180px;
  max-width: 100%;
  aspect-ratio: 4 / 3;
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
  border-radius: 6px;
  background: rgba(0, 0, 0, 0.12);
  outline: 1px solid rgba(255, 255, 255, 0.1);
}
.agent-image :deep(.n-image),
.agent-image :deep(img) {
  width: 100%;
  height: 100%;
}
.image-error {
  padding: 8px;
  font-size: 12px;
  overflow-wrap: anywhere;
}
</style>
