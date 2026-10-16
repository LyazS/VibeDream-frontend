<template>
  <div ref="element" class="agent-image" :title="error ? t(error) : fileName">
    <NImage
      v-if="url && !error"
      :src="url"
      :alt="fileName || t('common.chat.image')"
      object-fit="contain"
      @error="error = 'aiPanel.errors.imageReadFailed'"
    />
    <span v-else-if="error" class="image-error" role="alert" :aria-label="t(error)">
      <RiFileDamageLine aria-hidden="true" />
    </span>
    <NSpin v-else :size="20" :aria-label="t('common.loading')" />
  </div>
</template>

<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { NImage, NSpin } from 'naive-ui'
import { RiFileDamageLine } from '@remixicon/vue'
import { createAgentImagePreview } from '@/core/agent/services/agentImageService'
import { useUnifiedStore } from '@/core/unifiedStore'
import { useAppI18n } from '@/core/composables/useI18n'
import { getAgentErrorKey } from './agentErrorMessage'

const props = defineProps<{ attachmentId: string }>()
const store = useUnifiedStore()
const { t } = useAppI18n()
const url = ref('')
const error = ref('')
const fileName = ref('')
const element = ref<HTMLElement>()
const previewActive = ref(typeof IntersectionObserver === 'undefined')
let withinBuffer = previewActive.value
let observer: IntersectionObserver | undefined
let releaseTimer: ReturnType<typeof setTimeout> | null = null
function clearReleaseTimer() {
  if (releaseTimer !== null) clearTimeout(releaseTimer)
  releaseTimer = null
}
onMounted(() => {
  if (typeof IntersectionObserver === 'undefined' || !element.value) return
  observer = new IntersectionObserver(
    ([entry]) => {
      withinBuffer = Boolean(entry?.isIntersecting)
      if (withinBuffer) {
        clearReleaseTimer()
        previewActive.value = true
      } else if (previewActive.value && releaseTimer === null) {
        releaseTimer = setTimeout(() => {
          releaseTimer = null
          previewActive.value = false
        }, 2000)
      }
    },
    { root: element.value.closest('.chat-messages-container'), rootMargin: '300px 0px' },
  )
  observer.observe(element.value)
})
watch(
  () => [props.attachmentId, store.agentSessionId],
  () => {
    clearReleaseTimer()
    previewActive.value = withinBuffer
  },
  { flush: 'sync' },
)
watch(
  () => [props.attachmentId, store.agentSessionId, previewActive.value],
  (_value, _old, onCleanup) => {
    let current = true
    let preview: ReturnType<typeof createAgentImagePreview> | undefined
    url.value = ''
    error.value = ''
    fileName.value = ''
    onCleanup(() => {
      current = false
      preview?.dispose()
    })
    if (!previewActive.value) return
    void store
      .getAgentImage(props.attachmentId)
      .then((image) => {
        if (!current) return
        preview = createAgentImagePreview(image.blob)
        url.value = preview.url
        fileName.value = image.fileName
      })
      .catch((reason: unknown) => {
        if (current) error.value = getAgentErrorKey(reason, 'aiPanel.errors.imageReadFailed')
      })
  },
  { immediate: true },
)
onBeforeUnmount(() => {
  clearReleaseTimer()
  observer?.disconnect()
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
  outline: 1px solid rgba(255, 255, 255, 0.1);
  outline-offset: -1px;
}
.image-error {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 100%;
  height: 100%;
  background: var(--color-bg-tertiary);
  color: var(--color-text-secondary);
}
.image-error svg {
  width: 24px;
  height: 24px;
}
</style>
