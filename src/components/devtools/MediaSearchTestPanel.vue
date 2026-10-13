<template>
  <section class="media-search-test-panel" :aria-label="t('aiPanel.devtools.mediaSearch.title')">
    <form class="search-form" @submit.prevent="runSearch">
      <div class="query-row">
        <n-input
          v-model:value="query"
          :disabled="isSearching"
          :placeholder="t('aiPanel.devtools.mediaSearch.placeholder')"
          clearable
          size="small"
        />
        <n-input-number
          v-model:value="topK"
          :disabled="isSearching"
          :min="1"
          :max="10"
          :show-button="true"
          size="small"
          :aria-label="t('aiPanel.devtools.resultLimit')"
        />
        <n-button
          type="primary"
          size="small"
          :loading="isSearching"
          :disabled="!query.trim() || !unifiedStore.projectId"
          attr-type="submit"
        >
          <template #icon>
            <component :is="IconComponents.SEARCH" size="16px" />
          </template>
          {{ t('common.search') }}
        </n-button>
        <n-button v-if="isSearching" size="small" secondary @click="cancelSearch">
          <template #icon>
            <component :is="IconComponents.STOP" size="14px" />
          </template>
          {{ t('common.cancel') }}
        </n-button>
      </div>
    </form>

    <p v-if="!unifiedStore.projectId" class="notice">
      {{ t('aiPanel.devtools.mediaSearch.openProject') }}
    </p>
    <p v-else-if="isSearching" class="status-line" aria-live="polite">
      <span>{{ stageLabel }}</span>
      <span v-if="indexingTotal > 0">{{
        t('aiPanel.devtools.mediaSearch.indexProgress', {
          resolved: indexingResolved,
          total: indexingTotal,
        })
      }}</span>
      <span>{{ completedSteps }}/{{ totalSteps }}</span>
    </p>
    <div v-if="isSearching" class="progress-track" aria-hidden="true">
      <div class="progress-value" :style="{ width: `${progressPercent}%` }"></div>
    </div>

    <p v-if="error" class="notice error" role="alert">{{ t(error) }}</p>
    <p v-else-if="wasCancelled" class="notice">{{ t('aiPanel.devtools.mediaSearch.cancelled') }}</p>
    <p v-else-if="hasSearched && !isSearching && results.length === 0" class="notice">
      {{ t('aiPanel.devtools.mediaSearch.noResults') }}
    </p>

    <div v-if="results.length > 0" class="result-summary">
      {{ t('aiPanel.devtools.mediaSearch.resultCount', { count: results.length }) }}
    </div>
    <ol v-if="results.length > 0" class="result-list">
      <li v-for="result in results" :key="result.point_id" class="result-item">
        <div class="result-main">
          <div class="result-heading">
            <strong>{{ result.title || result.media_name }}</strong>
            <span class="media-kind">{{ t(`aiPanel.${result.media_kind}`) }}</span>
            <span v-if="result.validation_result?.verdict === 'uncertain'" class="review-state">
              {{ t('aiPanel.devtools.mediaSearch.review') }}
            </span>
          </div>
          <p v-if="result.summary" class="result-summary-text">{{ result.summary }}</p>
          <div class="result-meta">
            <span>{{
              t('aiPanel.devtools.mediaSearch.score', {
                score: formatScore(result.rerank_score ?? result.score),
              })
            }}</span>
            <span v-if="result.segment">
              {{ result.segment.start_timecode }} - {{ result.segment.end_timecode }}
            </span>
            <span v-if="result.validation_result?.reason">{{
              result.validation_result.reason
            }}</span>
          </div>
        </div>
        <n-button size="tiny" quaternary @click="revealInLibrary(result.media_item_id)">
          {{ t('aiPanel.devtools.mediaSearch.reveal') }}
        </n-button>
      </li>
    </ol>
  </section>
</template>

<script setup lang="ts">
import { computed, onUnmounted, ref } from 'vue'
import { NButton, NInput, NInputNumber } from 'naive-ui'
import { IconComponents } from '@/constants/iconComponents'
import { useAppI18n } from '@/core/composables/useI18n'
import { getAgentErrorKey } from '@/components/agent/agentErrorMessage'
import { useUnifiedStore } from '@/core/unifiedStore'
import {
  searchMedia,
  type RetrievalResultItem,
  type SearchMediaStage,
} from '@/core/agent/services/mediaIndexService'

const unifiedStore = useUnifiedStore()
const { t } = useAppI18n()

const query = ref('')
const topK = ref<number | null>(5)
const results = ref<RetrievalResultItem[]>([])
const error = ref('')
const hasSearched = ref(false)
const wasCancelled = ref(false)
const isSearching = ref(false)
const activeStage = ref<SearchMediaStage | null>(null)
const completedSteps = ref(0)
const totalSteps = ref(4)
const indexingResolved = ref(0)
const indexingTotal = ref(0)

let activeController: AbortController | null = null

const stageLabel = computed(() =>
  t(`aiPanel.devtools.mediaSearch.stages.${activeStage.value ?? 'preparing'}`),
)

const progressPercent = computed(() => {
  if (totalSteps.value <= 0) return 0
  return Math.min(100, Math.max(0, (completedSteps.value / totalSteps.value) * 100))
})

function formatScore(score: number): string {
  return Number.isFinite(score) ? score.toFixed(3) : '-'
}

function checkCancelled(controller: AbortController): void {
  if (controller.signal.aborted) {
    throw new DOMException('SEARCH_CANCELLED', 'AbortError')
  }
}

async function runSearch(): Promise<void> {
  if (isSearching.value || !query.value.trim() || !unifiedStore.projectId) return

  const controller = new AbortController()
  activeController = controller
  results.value = []
  error.value = ''
  hasSearched.value = true
  wasCancelled.value = false
  isSearching.value = true
  activeStage.value = 'indexing'
  completedSteps.value = 0
  totalSteps.value = 4
  indexingResolved.value = 0
  indexingTotal.value = 0

  try {
    const response = await searchMedia({
      query: query.value,
      projectId: unifiedStore.projectId,
      getMediaItem: (id) => unifiedStore.getMediaItem(id),
      mediaItems: unifiedStore.mediaItems || [],
      ensureMediaIndexing: (id) => unifiedStore.ensureMediaIndexing(id),
      t: (key, params) => (params ? t(key, params) : t(key)),
      topK: topK.value ?? 5,
      signal: controller.signal,
      checkCancelled: () => checkCancelled(controller),
      onProgress: (stage, completed, total) => {
        activeStage.value = stage
        completedSteps.value = completed
        totalSteps.value = total
      },
      onIndexingProgress: (resolved, total) => {
        indexingResolved.value = resolved
        indexingTotal.value = total
      },
    })

    if (!controller.signal.aborted) {
      results.value = response.results
      if (response.error) {
        console.error('Media search failed:', response.error)
        error.value = getAgentErrorKey(response.error, 'aiPanel.devtools.mediaSearch.searchFailed')
      }
    }
  } catch (cause) {
    if (!controller.signal.aborted) {
      console.error('Media search failed:', cause)
      error.value = getAgentErrorKey(cause, 'aiPanel.devtools.mediaSearch.searchFailed')
    }
  } finally {
    if (activeController === controller) {
      activeController = null
      isSearching.value = false
    }
  }
}

function cancelSearch(): void {
  wasCancelled.value = true
  activeController?.abort()
}

function revealInLibrary(mediaId: string): void {
  const response = unifiedStore.revealMediaInLibrary(mediaId)
  if (!response.success) {
    console.error('Unable to reveal media:', response.error)
    error.value = getAgentErrorKey(response.error, 'aiPanel.devtools.mediaSearch.revealFailed')
  }
}

onUnmounted(cancelSearch)
</script>

<style scoped>
.media-search-test-panel {
  height: 100%;
  overflow-y: auto;
  padding: var(--spacing-md);
  color: var(--color-text-primary);
}

.search-form {
  padding-bottom: var(--spacing-md);
  border-bottom: 1px solid var(--color-border);
}

.query-row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 76px auto auto;
  gap: var(--spacing-sm);
  align-items: center;
}

.notice,
.status-line,
.result-summary,
.result-summary-text,
.result-meta {
  margin: 0;
  font-size: 12px;
  line-height: 1.5;
}

.notice {
  padding: var(--spacing-md) 0;
  color: var(--color-text-secondary);
}

.notice.error {
  color: var(--color-error);
}

.status-line {
  display: flex;
  justify-content: space-between;
  gap: var(--spacing-sm);
  padding: var(--spacing-md) 0 var(--spacing-sm);
  color: var(--color-text-secondary);
}

.progress-track {
  width: 100%;
  height: 3px;
  overflow: hidden;
  background: var(--color-border);
}

.progress-value {
  height: 100%;
  background: var(--color-primary);
  transition: width 160ms ease;
}

.result-summary {
  padding: var(--spacing-md) 0 var(--spacing-sm);
  color: var(--color-text-secondary);
}

.result-list {
  margin: 0;
  padding: 0;
  list-style: none;
}

.result-item {
  display: flex;
  gap: var(--spacing-sm);
  justify-content: space-between;
  padding: var(--spacing-md) 0;
  border-bottom: 1px solid var(--color-border);
}

.result-main {
  min-width: 0;
}

.result-heading,
.result-meta {
  display: flex;
  flex-wrap: wrap;
  gap: 4px var(--spacing-sm);
  align-items: center;
}

.result-heading strong {
  overflow: hidden;
  font-size: 13px;
  line-height: 20px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.media-kind,
.review-state {
  padding: 1px 5px;
  color: var(--color-text-secondary);
  font-size: 11px;
  line-height: 16px;
  background: var(--color-bg-secondary);
}

.review-state {
  color: var(--color-warning);
}

.result-summary-text {
  display: -webkit-box;
  margin-top: 4px;
  overflow: hidden;
  color: var(--color-text-secondary);
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
}

.result-meta {
  margin-top: 5px;
  color: var(--color-text-tertiary);
}

@media (max-width: 420px) {
  .query-row {
    grid-template-columns: minmax(0, 1fr) 68px auto;
  }

  .query-row :deep(.n-button:last-child) {
    grid-column: 1 / -1;
    justify-self: end;
  }

  .result-item {
    align-items: flex-start;
  }
}
</style>
