<template>
  <div class="agent-image">
    <NImage v-if="url" :src="url" :alt="t('common.chat.image')" object-fit="contain" />
    <span v-else-if="error" class="image-error" role="alert">{{ t(error) }}</span>
    <span v-else>{{ t('common.loading') }}</span>
  </div>
</template>

<script setup lang="ts">
import { onBeforeUnmount, ref, watch } from 'vue'
import { NImage } from 'naive-ui'
import { createAgentImagePreview } from '@/core/agent/services/agentImageService'
import { useUnifiedStore } from '@/core/unifiedStore'
import { useAppI18n } from '@/core/composables/useI18n'
import { getAgentErrorKey } from './agentErrorMessage'

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
        if (current) error.value = getAgentErrorKey(reason, 'aiPanel.errors.imageReadFailed')
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
  width: 60px;
  max-width: 100%;
  aspect-ratio: 1;
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
  border-radius: 6px;
}
.agent-image :deep(.n-image),
.agent-image :deep(img) {
  width: 100%;
  height: 100%;
}
.agent-image :deep(img) {
  border-radius: 6px;
}
.image-error {
  padding: 8px;
  font-size: 12px;
  overflow-wrap: anywhere;
}
</style>
