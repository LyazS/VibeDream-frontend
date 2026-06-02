<template>
  <div class="media-index-panel">
    <div class="index-content">
      <p class="description">点击按钮索引素材库中所有视频和图片素材</p>
      <n-button
        type="primary"
        :loading="isIndexing"
        :disabled="isIndexing || mediaItemCount === 0"
        @click="onIndexAllClick"
        block
      >
        {{ isIndexing ? t('aiPanel.indexingAllMedia') : t('aiPanel.indexAllMedia') }}
      </n-button>
      <n-button
        :loading="isReconciling"
        :disabled="isReconciling || mediaItemCount === 0"
        @click="onReconcileClick"
        block
      >
        {{ isReconciling ? t('aiPanel.reconcilingMediaIndex') : t('aiPanel.reconcileMediaIndex') }}
      </n-button>
      <p v-if="resultMessage" class="result-message">{{ resultMessage }}</p>
    </div>

    <n-divider style="margin: 12px 0" />

    <div class="search-section">
      <div class="search-input-row">
        <n-input
          v-model:value="searchQuery"
          :placeholder="t('aiPanel.search.placeholder')"
          clearable
          @keydown.enter="onSearchSubmit"
          style="flex: 1"
        />
        <n-button
          type="primary"
          :loading="isSearching"
          :disabled="isSearching || !searchQuery.trim()"
          @click="onSearchSubmit"
          style="margin-left: 8px"
        >
          {{ isSearching ? t('aiPanel.search.searching') : t('aiPanel.search.button') }}
        </n-button>
      </div>

      <div class="search-options-row">
        <n-checkbox v-model:checked="enableValidation">
          {{ t('aiPanel.search.enableValidation') }}
        </n-checkbox>
      </div>

      <div v-if="searchError" class="search-error">{{ searchError }}</div>

      <div v-if="isSearching" class="search-loading">
        <n-spin size="small" />
        <span>{{ t('aiPanel.search.searching') }}</span>
      </div>

      <div v-else-if="hasSearched && searchResults.length === 0" class="search-empty">
        {{ t('aiPanel.search.noResults') }}
      </div>

      <div v-else-if="searchResults.length > 0" class="search-results">
        <div class="search-results-header">
          {{
            validationRelevantCount > 0
              ? t('aiPanel.search.resultCountWithRelevant', {
                  count: searchResults.length,
                  relevant: validationRelevantCount,
                })
              : t('aiPanel.search.resultCount', { count: searchResults.length })
          }}
        </div>
        <div
          v-for="result in searchResults"
          :key="result.point_id"
          class="result-card"
          :class="{ 'result-card--selected': selectedPointId === result.point_id }"
          @click="selectedPointId = selectedPointId === result.point_id ? null : result.point_id"
        >
          <div class="result-card-header">
            <span class="result-media-name">{{ result.media_name }}</span>
            <span class="result-media-kind" :class="`result-media-kind--${result.media_kind}`">
              {{ result.media_kind === 'video' ? t('aiPanel.search.video') : t('aiPanel.search.image') }}
            </span>
          </div>

          <div v-if="result.segment" class="result-timecode">
            {{ result.segment.start_timecode }} - {{ result.segment.end_timecode }}
          </div>

          <div v-if="result.title" class="result-title">{{ result.title }}</div>
          <div v-if="result.summary" class="result-summary">
            {{ selectedPointId === result.point_id ? result.summary : truncateText(result.summary, 120) }}
          </div>

          <div class="result-meta">
            <span v-if="result.routes.length > 0" class="result-routes">
              {{ t('aiPanel.search.routes') }}: {{ result.routes.join(', ') }}
            </span>
            <span v-if="result.rerank_score != null" class="result-rerank-score">
              rerank: {{ result.rerank_score.toFixed(3) }}
            </span>
          </div>

          <div
            v-if="result.validation_result"
            class="validation-badge"
            :class="`validation-badge--${result.validation_result.verdict}`"
          >
            {{ validationLabel(result.validation_result.verdict) }}
          </div>
          <div v-if="result.validation_result?.reason" class="validation-reason">
            {{ result.validation_result.reason }}
          </div>

          <div v-if="result.keyword_matches.length > 0" class="result-keyword-matches">
            <span
              v-for="match in result.keyword_matches.slice(0, 3)"
              :key="match.field"
              class="keyword-match-tag"
            >
              {{ match.matched_terms[0] }}
            </span>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue'
import { NButton, NInput, NDivider, NSpin, NCheckbox } from 'naive-ui'
import { useUnifiedStore } from '@/core/unifiedStore'
import { useAppI18n } from '@/core/composables/useI18n'
import {
  indexAllMedia,
  reconcileMediaIndexing,
  searchMedia,
  type RetrievalResultItem,
  type ValidationResultItem,
} from '../agent/services/mediaIndexService'

const { t } = useAppI18n()
const unifiedStore = useUnifiedStore()

const isIndexing = ref(false)
const isReconciling = ref(false)
const resultMessage = ref('')

const searchQuery = ref('')
const isSearching = ref(false)
const hasSearched = ref(false)
const searchError = ref('')
const searchResults = ref<RetrievalResultItem[]>([])
const selectedPointId = ref<string | null>(null)
const enableValidation = ref(true)

const mediaItemCount = computed(() => {
  return (unifiedStore.mediaItems || []).filter(
    (item) => item.mediaType === 'video' || item.mediaType === 'image',
  ).length
})

const validationRelevantCount = computed(() => {
  return searchResults.value.filter((result) => result.validation_result?.verdict === 'relevant').length
})

const onIndexAllClick = async () => {
  isIndexing.value = true
  resultMessage.value = ''

  try {
    resultMessage.value = await indexAllMedia({
      mediaItems: unifiedStore.mediaItems || [],
      ensureMediaIndexing: (id) => unifiedStore.ensureMediaIndexing(id),
      t,
    })
  } catch (error) {
    console.error('索引全部素材失败:', error)
    resultMessage.value = `索引失败: ${error}`
  } finally {
    isIndexing.value = false
  }
}

const onReconcileClick = async () => {
  if (!unifiedStore.projectId) {
    resultMessage.value = t('aiPanel.reconcileMediaIndexProjectMissing')
    return
  }

  const mediaIds = (unifiedStore.mediaItems || [])
    .filter((item) => item.mediaType === 'video' || item.mediaType === 'image')
    .map((item) => item.id)

  if (mediaIds.length === 0) {
    resultMessage.value = t('aiPanel.reconcileMediaIndexNoItems')
    return
  }

  isReconciling.value = true
  resultMessage.value = ''

  try {
    const result = await reconcileMediaIndexing(unifiedStore.projectId, mediaIds)
    const indexingResults = await Promise.allSettled(
      result.unindexed_media_ids.map((mediaId) => unifiedStore.ensureMediaIndexing(mediaId)),
    )
    const startedIndexingCount = indexingResults.filter((item) => item.status === 'fulfilled').length
    const failedIndexingCount = indexingResults.length - startedIndexingCount

    resultMessage.value = t('aiPanel.reconcileMediaIndexSuccess', {
      unindexed: result.unindexed_media_ids.length,
      startedIndexing: startedIndexingCount,
      failedIndexing: failedIndexingCount,
      deletedMedia: result.deleted_orphan_media_count,
      deletedPoints: result.deleted_orphan_point_count,
    })
  } catch (error) {
    console.error('素材索引对账失败:', error)
    resultMessage.value = t('aiPanel.reconcileMediaIndexFailed', { error: String(error) })
  } finally {
    isReconciling.value = false
  }
}

const onSearchSubmit = async () => {
  if (!searchQuery.value.trim()) return

  isSearching.value = true
  hasSearched.value = true
  searchError.value = ''
  searchResults.value = []
  selectedPointId.value = null

  try {
    const { results, error } = await searchMedia({
      query: searchQuery.value,
      projectId: unifiedStore.projectId,
      getMediaItem: (id) => unifiedStore.getMediaItem(id),
      t,
      enableValidation: enableValidation.value,
    })
    searchResults.value = results
    searchError.value = error
  } catch (error) {
    console.error('素材搜索失败:', error)
    searchError.value = t('aiPanel.search.error', { error: String(error) })
  } finally {
    isSearching.value = false
  }
}

const truncateText = (text: string, maxLen: number) => {
  if (text.length <= maxLen) return text
  return text.slice(0, maxLen) + '...'
}

const validationLabel = (verdict: ValidationResultItem['verdict']) => {
  if (verdict === 'relevant') return t('aiPanel.search.validationRelevant')
  if (verdict === 'uncertain') return t('aiPanel.search.validationUncertain')
  if (verdict === 'irrelevant') return t('aiPanel.search.validationIrrelevant')
  return t('aiPanel.search.validationError')
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

.search-section {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.search-input-row {
  display: flex;
  align-items: center;
}

.search-options-row {
  display: flex;
  align-items: center;
}

.search-loading {
  display: flex;
  align-items: center;
  gap: 8px;
  color: var(--text-color-secondary);
  font-size: 13px;
  padding: 16px 0;
  justify-content: center;
}

.search-error {
  color: var(--error-color, #e74c3c);
  font-size: 12px;
  padding: 4px 0;
}

.search-empty {
  color: var(--text-color-secondary);
  font-size: 13px;
  text-align: center;
  padding: 16px 0;
}

.search-results-header {
  color: var(--text-color-secondary);
  font-size: 12px;
  margin-bottom: 4px;
}

.search-results {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.result-card {
  border: 1px solid var(--border-color, #e0e0e0);
  border-radius: 6px;
  padding: 8px 10px;
  cursor: pointer;
  transition: border-color 0.15s, background-color 0.15s;
}

.result-card:hover {
  border-color: var(--primary-color, #1890ff);
}

.result-card--selected {
  border-color: var(--primary-color, #1890ff);
  background-color: var(--primary-color-hover, rgba(24, 144, 255, 0.06));
}

.result-card-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.result-media-name {
  font-size: 13px;
  font-weight: 500;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  flex: 1;
}

.result-media-kind {
  font-size: 11px;
  padding: 1px 6px;
  border-radius: 3px;
  flex-shrink: 0;
}

.result-media-kind--video {
  background: rgba(24, 144, 255, 0.1);
  color: #1890ff;
}

.result-media-kind--image {
  background: rgba(82, 196, 26, 0.1);
  color: #52c41a;
}

.result-timecode {
  font-size: 11px;
  color: var(--text-color-secondary);
  font-family: monospace;
  margin-top: 2px;
}

.result-title {
  font-size: 13px;
  font-weight: 500;
  margin-top: 4px;
}

.result-summary {
  font-size: 12px;
  color: var(--text-color-secondary);
  margin-top: 2px;
  line-height: 1.4;
}

.result-meta {
  margin-top: 4px;
}

.result-routes {
  font-size: 11px;
  color: var(--text-color-tertiary, #999);
}

.result-rerank-score {
  font-size: 11px;
  color: var(--primary-color, #1890ff);
  font-family: monospace;
}

.validation-badge {
  display: inline-flex;
  align-items: center;
  width: fit-content;
  margin-top: 6px;
  padding: 1px 8px;
  border-radius: 999px;
  font-size: 11px;
  font-weight: 600;
}

.validation-badge--relevant {
  background: rgba(22, 119, 255, 0.12);
  color: #0958d9;
}

.validation-badge--uncertain {
  background: rgba(250, 173, 20, 0.14);
  color: #ad6800;
}

.validation-badge--irrelevant,
.validation-badge--error {
  background: rgba(245, 34, 45, 0.12);
  color: #cf1322;
}

.validation-reason {
  margin-top: 4px;
  font-size: 12px;
  color: var(--text-color-secondary);
  line-height: 1.4;
}

.result-keyword-matches {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  margin-top: 4px;
}

.keyword-match-tag {
  font-size: 11px;
  padding: 1px 6px;
  border-radius: 3px;
  background: rgba(250, 173, 20, 0.1);
  color: #d48806;
}
</style>
