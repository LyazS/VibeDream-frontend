<template>
  <section class="transition-test-panel" :aria-label="t('aiPanel.devtools.transition.title')">
    <div class="catalog-bar">
      <span v-if="catalogLoading">{{ t('aiPanel.devtools.transition.catalogLoading') }}</span>
      <span v-else-if="catalog">{{
        t('aiPanel.devtools.transition.catalogSummary', {
          count: catalog.items.length,
          version: catalog.catalog_version.slice(0, 12),
        })
      }}</span>
      <span v-else>{{ t('aiPanel.devtools.transition.catalogUnavailable') }}</span>
      <n-button
        size="tiny"
        quaternary
        :loading="catalogLoading"
        :title="t('aiPanel.devtools.transition.refresh')"
        :aria-label="t('aiPanel.devtools.transition.refresh')"
        @click="loadCatalog"
      >
        <template #icon><component :is="IconComponents.REFRESH" size="15px" /></template>
      </n-button>
    </div>

    <form class="search-form" @submit.prevent="runSearch">
      <n-input
        v-model:value="query"
        clearable
        size="small"
        :placeholder="t('aiPanel.devtools.transition.placeholder')"
      />
      <div class="search-actions">
        <n-input-number
          v-model:value="topK"
          :min="1"
          :max="10"
          size="small"
          :aria-label="t('aiPanel.devtools.resultLimit')"
        />
        <n-button
          type="primary"
          size="small"
          attr-type="submit"
          :loading="searching"
          :disabled="!query.trim()"
        >
          <template #icon><component :is="IconComponents.SEARCH" size="16px" /></template>
          {{ t('common.search') }}
        </n-button>
      </div>
    </form>

    <div class="target-row">
      <span>{{ t('aiPanel.devtools.transition.target') }}</span>
      <n-select
        v-model:value="selectedSeamId"
        size="small"
        :options="seamOptions"
        :disabled="seamOptions.length === 0"
        :placeholder="
          t(
            seamOptions.length
              ? 'aiPanel.devtools.transition.selectSeam'
              : 'aiPanel.devtools.transition.noSeams',
          )
        "
      />
    </div>

    <p v-if="error" class="notice error" role="alert">{{ t(error) }}</p>
    <p v-if="message" class="notice success" role="status">
      {{
        t(message.key, {
          name: nameFor(message.templateId, message.name),
          target: message.target ?? '',
        })
      }}
    </p>
    <p v-if="searched && !searching && !results.length && !error" class="notice">
      {{ t('aiPanel.devtools.transition.noResults') }}
    </p>

    <ol class="result-list">
      <li v-for="hit in results" :key="hit.templateId" class="result-item">
        <div class="result-heading">
          <strong>{{ nameFor(hit.templateId, hit.name) }}</strong>
          <span>{{ formatScore(hit.score) }}</span>
        </div>
        <p class="result-description">
          {{ summaryFor(hit.templateId)?.summary[language] || hit.description }}
        </p>
        <div class="result-meta">
          <span>{{ hit.templateId }}</span>
          <span v-if="hit.matchedTraits.length">{{
            hit.matchedTraits.slice(0, 3).join(' · ')
          }}</span>
        </div>
        <div class="result-actions">
          <n-button
            size="small"
            secondary
            :loading="workingId === hit.templateId && workingAction === 'install'"
            :disabled="!!workingId"
            @click="install(hit)"
          >
            <template #icon><component :is="IconComponents.DOWNLOAD" size="15px" /></template>
            {{
              t(
                installedIds.includes(hit.templateId)
                  ? 'aiPanel.devtools.transition.recheck'
                  : 'aiPanel.devtools.transition.install',
              )
            }}
          </n-button>
          <n-button
            size="small"
            type="primary"
            :loading="workingId === hit.templateId && workingAction === 'apply'"
            :disabled="!!workingId || !selectedSeamId"
            @click="apply(hit)"
          >
            <template #icon><component :is="IconComponents.PLAY" size="14px" /></template>
            {{ t('aiPanel.devtools.transition.apply') }}
          </n-button>
        </div>
      </li>
    </ol>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { NButton, NInput, NInputNumber, NSelect } from 'naive-ui'
import { IconComponents } from '@/constants/iconComponents'
import { useAppI18n } from '@/core/composables/useI18n'
import { getAgentErrorKey } from '@/components/agent/agentErrorMessage'
import { fetchClient } from '@/utils/fetchClient'
import { transitionTemplateCatalogService } from '@/core/effect-template/TransitionTemplateCatalogService'
import type { TransitionTemplateListResponse } from '@/core/effect-template/catalogTypes'
import { framesToTimecode } from '@/core/utils/timeUtils'
import { supportsClipTransitionOut } from '@/core/timelineitem/features/transition'
import { useUnifiedStore } from '@/core/unifiedStore'
import { executeApplyTransition } from '@/core/agent/tools/transitionTools'
import { getTrackItems, resolveTransitionTemplate } from '@/core/agent/tools/transitionItemShared'

interface TransitionHit {
  templateId: string
  catalog_version: string
  name: string
  description: string
  matchedTraits: string[]
  score: number
}

const store = useUnifiedStore()
const { t, locale } = useAppI18n()
const language = computed(() => (locale.value === 'zh-CN' ? 'zh' : 'en'))
const query = ref('')
const topK = ref<number | null>(5)
const catalog = ref<TransitionTemplateListResponse | null>(null)
const catalogLoading = ref(false)
const searching = ref(false)
const searched = ref(false)
const results = ref<TransitionHit[]>([])
const selectedSeamId = ref<string | null>(null)
const workingId = ref('')
const workingAction = ref<'install' | 'apply' | ''>('')
const installedIds = ref<string[]>([])
const error = ref('')
const message = ref<{ key: string; templateId: string; name: string; target?: string } | null>(null)

const seams = computed(() =>
  store.tracks
    .filter((track) => track.type === 'video')
    .flatMap((track) => {
      const items = getTrackItems(track.id)
      return items.slice(0, -1).flatMap((left, index) => {
        const right = items[index + 1]
        const seamFrame = left.timeRange.timelineEndTime
        if (!supportsClipTransitionOut(left) || seamFrame !== right.timeRange.timelineStartTime)
          return []
        return [
          {
            trackId: track.id,
            leftClipId: left.id,
            rightClipId: right.id,
            seamFrame,
            label: `${track.name} · ${framesToTimecode(seamFrame)}`,
          },
        ]
      })
    }),
)
const seamOptions = computed(() =>
  seams.value.map((seam) => ({ label: seam.label, value: seam.leftClipId })),
)

watch(
  seams,
  (current) => {
    if (!current.some((seam) => seam.leftClipId === selectedSeamId.value)) {
      selectedSeamId.value = current[0]?.leftClipId ?? null
    }
  },
  { immediate: true },
)

function summaryFor(id: string) {
  return catalog.value?.items.find((item) => item.id === id)
}

function nameFor(id: string, fallback: string) {
  return summaryFor(id)?.name[language.value] || fallback
}

function formatScore(score: number): string {
  return Number.isFinite(score) ? score.toFixed(3) : '-'
}

async function loadCatalog(): Promise<void> {
  catalogLoading.value = true
  error.value = ''
  try {
    const current = await transitionTemplateCatalogService.getCatalogVersion()
    catalog.value = await transitionTemplateCatalogService.getTemplateSummaries(
      current.catalog_version,
    )
    if (catalog.value.items.length !== current.total) throw new Error('TRANSITION_CATALOG_MISMATCH')
  } catch (cause) {
    catalog.value = null
    console.error('Transition catalog failed:', cause)
    error.value =
      cause instanceof Error && cause.message === 'TRANSITION_CATALOG_MISMATCH'
        ? 'aiPanel.devtools.transition.catalogMismatch'
        : getAgentErrorKey(cause, 'aiPanel.devtools.transition.catalogFailed')
  } finally {
    catalogLoading.value = false
  }
}

async function runSearch(): Promise<void> {
  if (!query.value.trim() || searching.value) return
  searching.value = true
  searched.value = true
  error.value = ''
  message.value = null
  results.value = []
  try {
    const response = await fetchClient.post<{ results: TransitionHit[] }>(
      '/api/transitions/test-search',
      { query: query.value.trim(), topK: topK.value ?? 5 },
    )
    results.value = response.data.results
    if (
      catalog.value &&
      results.value.some((hit) => hit.catalog_version !== catalog.value?.catalog_version)
    ) {
      await loadCatalog()
    }
  } catch (cause) {
    console.error('Transition search failed:', cause)
    error.value = getAgentErrorKey(cause, 'aiPanel.devtools.transition.searchFailed')
  } finally {
    searching.value = false
  }
}

async function install(hit: TransitionHit): Promise<void> {
  workingId.value = hit.templateId
  workingAction.value = 'install'
  error.value = ''
  message.value = null
  try {
    await resolveTransitionTemplate(hit.templateId, hit.catalog_version)
    if (!installedIds.value.includes(hit.templateId)) installedIds.value.push(hit.templateId)
    message.value = {
      key: 'aiPanel.devtools.transition.installed',
      templateId: hit.templateId,
      name: hit.name,
    }
  } catch (cause) {
    console.error('Transition installation failed:', cause)
    error.value = getAgentErrorKey(cause, 'aiPanel.devtools.transition.installFailed')
  } finally {
    workingId.value = ''
    workingAction.value = ''
  }
}

async function apply(hit: TransitionHit): Promise<void> {
  const seam = seams.value.find((item) => item.leftClipId === selectedSeamId.value)
  if (!seam) return
  workingId.value = hit.templateId
  workingAction.value = 'apply'
  error.value = ''
  message.value = null
  try {
    const result = await executeApplyTransition({
      templateId: hit.templateId,
      catalog_version: hit.catalog_version,
      trackId: seam.trackId,
      leftClipId: seam.leftClipId,
      rightClipId: seam.rightClipId,
      seamTime: framesToTimecode(seam.seamFrame),
    })
    if (!result.success) throw new Error(result.error || 'TRANSITION_APPLY_FAILED')
    if (!installedIds.value.includes(hit.templateId)) installedIds.value.push(hit.templateId)
    message.value = {
      key: 'aiPanel.devtools.transition.applied',
      templateId: hit.templateId,
      name: hit.name,
      target: seam.label,
    }
  } catch (cause) {
    console.error('Transition application failed:', cause)
    error.value = getAgentErrorKey(cause, 'aiPanel.devtools.transition.applyFailed')
  } finally {
    workingId.value = ''
    workingAction.value = ''
  }
}

onMounted(loadCatalog)
</script>

<style scoped>
.transition-test-panel {
  height: 100%;
  overflow-y: auto;
  padding: var(--spacing-md);
  color: var(--color-text-primary);
}
.catalog-bar,
.search-actions,
.target-row,
.result-heading,
.result-actions {
  display: flex;
  align-items: center;
  gap: var(--spacing-sm);
}
.catalog-bar,
.result-meta {
  color: var(--color-text-secondary);
  font-size: 12px;
}
.catalog-bar {
  flex-wrap: wrap;
  justify-content: space-between;
  margin-bottom: var(--spacing-md);
}
.search-form {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: var(--spacing-sm);
}
.search-actions :deep(.n-input-number) {
  width: 76px;
}
.target-row {
  margin: var(--spacing-md) 0;
  font-size: 12px;
}
.target-row > span {
  white-space: nowrap;
}
.target-row :deep(.n-select) {
  min-width: 0;
  flex: 1;
}
.notice {
  margin: var(--spacing-md) 0;
  font-size: 12px;
  color: var(--color-text-secondary);
}
.error {
  color: var(--color-error);
}
.success {
  color: var(--color-success);
}
.result-list {
  list-style: none;
  margin: 0;
  padding: 0;
}
.result-item {
  padding: var(--spacing-md) 0;
  border-top: 1px solid var(--color-border);
}
.result-heading {
  justify-content: space-between;
  font-size: 13px;
}
.result-heading span {
  font-size: 12px;
  color: var(--color-text-secondary);
  font-variant-numeric: tabular-nums;
}
.result-description {
  margin: 6px 0;
  font-size: 12px;
  line-height: 1.5;
}
.result-meta {
  display: flex;
  flex-wrap: wrap;
  gap: var(--spacing-sm);
  overflow-wrap: anywhere;
}
.result-meta span {
  min-width: 0;
}
.result-actions {
  flex-wrap: wrap;
  margin-top: var(--spacing-sm);
}
@media (max-width: 520px) {
  .search-form {
    grid-template-columns: 1fr;
  }
  .search-actions {
    flex-wrap: wrap;
  }
  .target-row {
    flex-wrap: wrap;
  }
  .target-row :deep(.n-select) {
    flex-basis: 100%;
  }
}
</style>
