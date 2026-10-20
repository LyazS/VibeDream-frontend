<template>
  <MediaPreview
    :show="show"
    :source="preview.source"
    :error="preview.error"
    @update:show="emit('update:show', $event)"
    @close="emit('close')"
  />
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { useAppI18n } from '@/core/composables/useI18n'
import { useUnifiedStore } from '@/core/unifiedStore'
import { MediaItemQueries } from '@/core/mediaitem/queries'
import MediaPreview from '@/components/preview/MediaPreview.vue'
import type { MediaPreviewSource } from '@/components/preview/mediaPreview'

const props = defineProps<{ show: boolean; mediaItemId: string }>()
const emit = defineEmits<{ 'update:show': [value: boolean]; close: [] }>()
const { t } = useAppI18n()
const store = useUnifiedStore()

// 图片使用已解码的 ImageBitmap；只有音视频才持有 BunnyMedia 原文件。
const preview = computed<{ source: MediaPreviewSource | null; error: string }>(() => {
  if (!props.show) return { source: null, error: '' }
  const item = store.getMediaItem(props.mediaItemId)
  if (!item) return { source: null, error: t('media.mediaNotFound') }
  if (!MediaItemQueries.isReady(item))
    return { source: null, error: t('media.previewNotReady', { name: item.name }) }
  try {
    const type = item.mediaType
    if (type === 'image') {
      const bitmap = item.runtime.bunny?.imageClip
      if (bitmap) return { source: { type, bitmap, name: item.name }, error: '' }
      return { source: null, error: t('media.preview.loadFailed') }
    }
    const blob = item.runtime.bunny?.bunnyMedia?.getOriFile()
    if (blob && (type === 'video' || type === 'audio'))
      return { source: { type, blob, name: item.name }, error: '' }
  } catch {
    // 已丢失或不可读取的本地文件统一展示可读错误。
  }
  return { source: null, error: t('media.preview.loadFailed') }
})
</script>
