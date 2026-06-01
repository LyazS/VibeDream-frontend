<template>
  <div class="media-index-panel">
    <div class="index-content">
      <p class="description">点击按钮索引素材库中所有视频和图片素材</p>
      <n-button
        type="primary"
        :loading="isIndexing"
        :disabled="isIndexing || mediaItemCount === 0"
        @click="handleIndexAll"
        block
      >
        {{ isIndexing ? t('aiPanel.indexingAllMedia') : t('aiPanel.indexAllMedia') }}
      </n-button>
      <p v-if="resultMessage" class="result-message">{{ resultMessage }}</p>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue'
import { NButton } from 'naive-ui'
import { useUnifiedStore } from '@/core/unifiedStore'
import { useAppI18n } from '@/core/composables/useI18n'

const { t } = useAppI18n()
const unifiedStore = useUnifiedStore()

const isIndexing = ref(false)
const resultMessage = ref('')

const mediaItemCount = computed(() => {
  return (unifiedStore.mediaItems || []).filter(
    (item) => item.mediaType === 'video' || item.mediaType === 'image',
  ).length
})

const handleIndexAll = async () => {
  const items = (unifiedStore.mediaItems || []).filter(
    (item) => item.mediaType === 'video' || item.mediaType === 'image',
  )

  if (items.length === 0) {
    resultMessage.value = t('aiPanel.indexAllMediaNoItems')
    return
  }

  isIndexing.value = true
  resultMessage.value = ''

  try {
    await Promise.all(items.map((item) => unifiedStore.ensureMediaIndexing(item.id)))
    resultMessage.value = t('aiPanel.indexAllMediaSuccess', { count: items.length })
  } catch (error) {
    console.error('索引全部素材失败:', error)
    resultMessage.value = `索引失败: ${error}`
  } finally {
    isIndexing.value = false
  }
}
</script>

<style scoped>
.media-index-panel {
  flex: 1;
  display: flex;
  flex-direction: column;
  padding: var(--spacing-md);
  overflow: auto;
}

.index-content {
  display: flex;
  flex-direction: column;
  gap: var(--spacing-md);
}

.description {
  color: var(--text-color-secondary);
  font-size: 13px;
  margin: 0;
}

.result-message {
  color: var(--text-color-secondary);
  font-size: 12px;
  margin: 0;
}
</style>
