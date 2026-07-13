<template>
  <section class="transition-search-panel">
    <form class="search-form" @submit.prevent="runSearch">
      <n-input
        v-model:value="query"
        :placeholder="t('aiPanel.transitionSearch.placeholder')"
        :disabled="isLoading"
        clearable
        @keyup.enter="runSearch"
      />
      <n-button type="primary" attr-type="submit" :loading="isLoading" :disabled="!query.trim()">
        <template #icon><component :is="IconComponents.SEARCH" /></template>
        {{ t('aiPanel.transitionSearch.button') }}
      </n-button>
    </form>

    <n-alert v-if="errorMessage" type="error" :show-icon="true" class="state-alert">
      {{ t('aiPanel.transitionSearch.error', { error: errorMessage }) }}
    </n-alert>

    <div v-if="isLoading" class="loading-state">
      <n-spin size="small" />
      <span>{{ t('aiPanel.transitionSearch.searching') }}</span>
    </div>

    <n-empty
      v-else-if="hasSearched && !errorMessage && results.length === 0"
      :description="t('aiPanel.transitionSearch.noResults')"
      class="empty-state"
    />

    <div v-else-if="results.length" class="results" aria-live="polite">
      <div class="result-summary">
        {{ t('aiPanel.transitionSearch.resultCount', { count: results.length }) }}
      </div>
      <article v-for="(result, index) in results" :key="result.id" class="result-item">
        <div class="result-heading">
          <span class="rank">{{ index + 1 }}</span>
          <div class="result-title">
            <strong>{{ result.name.zh || result.name.en }}</strong>
            <span>{{ result.id }}</span>
          </div>
          <span class="score">{{ result.score.toFixed(4) }}</span>
        </div>
        <p>{{ result.summary.zh || result.summary.en }}</p>
        <div class="meta-row">
          <n-tag v-for="trait in result.matched_traits" :key="trait" size="small" :bordered="false">
            {{ trait }}
          </n-tag>
          <n-tag v-for="tag in result.tags.zh" :key="tag" size="small" :bordered="false" type="info">
            {{ tag }}
          </n-tag>
          <span class="duration">{{ result.duration_frames }} {{ t('aiPanel.transitionSearch.frames') }}</span>
        </div>
        <div v-if="result.parameter_keys.length" class="parameters">
          <span>{{ t('aiPanel.transitionSearch.parameters') }}</span>
          <code>{{ result.parameter_keys.join(', ') }}</code>
        </div>
      </article>
    </div>
  </section>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import { NAlert, NButton, NEmpty, NInput, NSpin, NTag } from 'naive-ui'
import { IconComponents } from '@/constants/iconComponents'
import { useAppI18n } from '@/core/composables/useI18n'
import { searchTransitions, type TransitionSearchResult } from '../services/transitionSearchService'

const { t } = useAppI18n()
const query = ref('')
const results = ref<TransitionSearchResult[]>([])
const isLoading = ref(false)
const hasSearched = ref(false)
const errorMessage = ref('')

async function runSearch() {
  const normalizedQuery = query.value.trim()
  if (!normalizedQuery || isLoading.value) return

  isLoading.value = true
  hasSearched.value = true
  errorMessage.value = ''
  try {
    const response = await searchTransitions(normalizedQuery)
    results.value = response.results
  } catch (error) {
    results.value = []
    errorMessage.value = error instanceof Error ? error.message : String(error)
  } finally {
    isLoading.value = false
  }
}
</script>

<style scoped>
.transition-search-panel {
  display: flex;
  min-height: 0;
  flex: 1;
  flex-direction: column;
  gap: var(--spacing-md);
  overflow: auto;
  padding: var(--spacing-md);
  -webkit-font-smoothing: antialiased;
}

.search-form {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: var(--spacing-sm);
}

.search-form :deep(.n-button) {
  min-height: 40px;
}

.state-alert,
.loading-state,
.empty-state {
  margin-top: var(--spacing-sm);
}

.loading-state {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: var(--spacing-sm);
  min-height: 96px;
  color: var(--text-color-3);
}

.results {
  display: flex;
  flex-direction: column;
  gap: var(--spacing-sm);
}

.result-summary,
.score,
.duration {
  color: var(--text-color-3);
  font-size: 12px;
  font-variant-numeric: tabular-nums;
}

.result-item {
  display: flex;
  flex-direction: column;
  gap: 8px;
  border-radius: 6px;
  background: var(--card-color);
  box-shadow: 0 1px 2px rgb(0 0 0 / 12%), 0 0 0 1px rgb(0 0 0 / 5%);
  padding: 12px;
}

.result-heading,
.meta-row,
.parameters {
  display: flex;
  align-items: center;
  gap: 8px;
}

.rank {
  display: inline-grid;
  width: 20px;
  height: 20px;
  place-items: center;
  border-radius: 50%;
  background: var(--primary-color-suppl);
  color: var(--primary-color);
  font-size: 12px;
  font-variant-numeric: tabular-nums;
}

.result-title {
  display: flex;
  min-width: 0;
  flex: 1;
  flex-direction: column;
  gap: 2px;
}

.result-title span,
.parameters code {
  overflow: hidden;
  color: var(--text-color-3);
  font-size: 12px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.result-item p {
  margin: 0;
  color: var(--text-color-2);
  font-size: 13px;
  line-height: 1.5;
  text-wrap: pretty;
}

.meta-row {
  flex-wrap: wrap;
}

.duration {
  margin-left: auto;
}

.parameters {
  min-width: 0;
  color: var(--text-color-3);
  font-size: 12px;
}

.parameters code {
  flex: 1;
}
</style>
