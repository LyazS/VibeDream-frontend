<template>
  <div ref="element" class="agent-image" :title="error ? t(error) : description || fileName">
    <button
      v-if="url && !error"
      type="button"
      class="image-preview-trigger"
      :aria-label="description || fileName || t('common.chat.image')"
      @click="showPreview = true"
    >
      <img
        :src="url"
        :alt="description || fileName || t('common.chat.image')"
        @error="error = 'aiPanel.errors.imageReadFailed'"
      />
    </button>
    <span v-else-if="error" class="image-error" role="alert" :aria-label="t(error)">
      <RiFileDamageLine aria-hidden="true" />
    </span>
    <NSpin v-else :size="20" :aria-label="t('common.loading')" />
    <MediaPreview
      v-if="showPreview && previewSource"
      v-model:show="showPreview"
      :source="previewSource"
    />
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue'
import { NSpin } from 'naive-ui'
import { RiFileDamageLine } from '@remixicon/vue'
import { createAgentImagePreview } from '@/core/agent/services/agentImageService'
import { useUnifiedStore } from '@/core/unifiedStore'
import { useAppI18n } from '@/core/composables/useI18n'
import { getAgentErrorKey } from './agentErrorMessage'
import MediaPreview from '@/components/preview/MediaPreview.vue'
import type { MediaPreviewSource } from '@/components/preview/mediaPreview'

const props = defineProps<{ attachmentId: string }>()
const store = useUnifiedStore()
const { t } = useAppI18n()
const url = ref('')
const error = ref('')
const fileName = ref('')
// 工具图片使用观察描述；用户附件没有描述时继续展示原文件名。
const description = ref('')
const imageBlob = shallowRef<Blob>()
const showPreview = ref(false)
const previewSource = computed<MediaPreviewSource | null>(() =>
  imageBlob.value
    ? { type: 'image', blob: imageBlob.value, name: description.value || fileName.value }
    : null,
)
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
    showPreview.value = false
    previewActive.value = withinBuffer
  },
  { flush: 'sync' },
)
watch(
  [
    () => props.attachmentId,
    () => store.agentSessionId,
    () => previewActive.value || showPreview.value,
  ],
  (_value, _old, onCleanup) => {
    let current = true
    let preview: ReturnType<typeof createAgentImagePreview> | undefined
    url.value = ''
    error.value = ''
    fileName.value = ''
    description.value = ''
    imageBlob.value = undefined
    onCleanup(() => {
      current = false
      preview?.dispose()
    })
    if (!previewActive.value && !showPreview.value) return
    void store
      .getAgentImage(props.attachmentId)
      .then((image) => {
        if (!current) return
        preview = createAgentImagePreview(image.blob)
        url.value = preview.url
        fileName.value = image.fileName
        description.value = image.description ?? ''
        imageBlob.value = image.blob
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
.image-preview-trigger,
.image-preview-trigger img {
  width: 100%;
  height: 100%;
}
.image-preview-trigger {
  display: block;
  padding: 0;
  border: 0;
  background: transparent;
  cursor: zoom-in;
}
.image-preview-trigger:focus-visible {
  outline: 2px solid var(--color-accent-primary);
  outline-offset: -2px;
}
.image-preview-trigger img {
  display: block;
  object-fit: contain;
  border-radius: 6px;
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
