<template>
  <LibrarySidebarShell>
    <template #sidebar>
      <EffectTemplateCategoryTabs
        :tabs="categoryTabs"
        :active-key="activeCategoryKey"
        @select="handleCategorySelect"
      />
    </template>

    <div class="effect-template-library">
      <div class="effect-template-library__toolbar">
        <label class="effect-template-library__search">
          <component :is="IconComponents.SEARCH" size="16px" />
          <input
            v-model="search"
            :placeholder="searchPlaceholder"
          />
        </label>
      </div>

      <div v-if="filteredItems.length === 0" class="effect-template-library__empty">
        <component :is="IconComponents.EMPTY" size="24px" />
        <p>{{ emptyTitle }}</p>
      </div>

      <div
        v-if="unifiedStore.viewMode !== 'list'"
        class="effect-template-library__grid"
        :class="`effect-template-library__grid--${unifiedStore.viewMode}`"
      >
        <button
          v-for="item in filteredItems"
          :key="item.effectPackageId"
          class="effect-template-item"
          :class="{
            'is-clickable': canInstall(item),
            'is-draggable': canDrag(item),
          }"
          :draggable="canDrag(item)"
          @click="void handleItemClick(item)"
          @dragstart="handleDragStart($event, item)"
        >
          <div class="effect-template-item__icon" :class="`effect-template-item__icon--${props.effectType}`">
            <component :is="getEffectTypeIcon(props.effectType)" size="24px" />
            <div
              class="effect-template-item__status"
              :class="[
                `effect-template-item__status--${getStatusTone(item)}`,
                `effect-template-item__status--${item.status}`,
              ]"
            >
              <component
                :is="getStatusIcon(item)"
                size="12px"
                :class="{ 'effect-template-item__status-icon--spin': getStatusTone(item) === 'processing' }"
              />
            </div>
          </div>
          <div class="effect-template-item__name">{{ item.displayName }}</div>
        </button>
      </div>

      <div v-else class="effect-template-library__list">
        <button
          v-for="item in filteredItems"
          :key="item.effectPackageId"
          class="effect-template-list-item"
          :class="{
            'is-clickable': canInstall(item),
            'is-draggable': canDrag(item),
          }"
          :draggable="canDrag(item)"
          @click="void handleItemClick(item)"
          @dragstart="handleDragStart($event, item)"
        >
          <div class="effect-template-list-item__icon" :class="`effect-template-list-item__icon--${props.effectType}`">
            <component :is="getEffectTypeIcon(props.effectType)" size="18px" />
            <div
              class="effect-template-item__status"
              :class="[
                `effect-template-item__status--${getStatusTone(item)}`,
                `effect-template-item__status--${item.status}`,
              ]"
            >
              <component
                :is="getStatusIcon(item)"
                size="12px"
                :class="{ 'effect-template-item__status-icon--spin': getStatusTone(item) === 'processing' }"
              />
            </div>
          </div>
          <div class="effect-template-list-item__name">{{ item.displayName }}</div>
        </button>
      </div>
    </div>
  </LibrarySidebarShell>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import LibrarySidebarShell from './LibrarySidebarShell.vue'
import EffectTemplateCategoryTabs from './EffectTemplateCategoryTabs.vue'
import { IconComponents, getEffectTypeIcon } from '@/constants/iconComponents'
import { effectTemplateRegistry } from '@/core/effect-template/EffectTemplateRegistry'
import type { CommonEffectType, CommonEffectTemplateStatus } from '@/core/effect-template/commonTypes'
import { DragSourceType, type MediaItemDragData } from '@/core/types/drag'
import { useUnifiedStore } from '@/core/unifiedStore'
import { useAppI18n } from '@/core/composables/useI18n'

interface Props {
  effectType: CommonEffectType
}

interface DisplayItem {
  effectPackageId: string
  templateId: string
  packageVersion: string
  catalogVersion: string
  status: CommonEffectTemplateStatus
  displayName: string
  searchTokens: string[]
  categoryKey: string
  categoryLabel: string
  durationFrames?: number
}

const props = defineProps<Props>()
const unifiedStore = useUnifiedStore()
const { t, locale } = useAppI18n()
const search = ref('')

const searchPlaceholder = computed(() =>
  props.effectType === 'transition'
    ? t('media.effectTemplateSearchTransition')
    : t('media.effectTemplateSearchFilter'),
)

const emptyTitle = computed(() =>
  search.value.trim()
    ? t('media.effectTemplateEmptySearch')
    : t('media.effectTemplateEmptyCategory'),
)

async function refresh(): Promise<void> {
  await effectTemplateRegistry.loadCatalog(props.effectType)
}

onMounted(() => {
  void refresh()
})

watch(() => props.effectType, () => {
  void refresh()
})

const items = computed<DisplayItem[]>(() =>
  effectTemplateRegistry
    .listStatesByType(props.effectType)
    .map((state) => {
      const isZhLocale = locale.value === 'zh-CN'
      const localizedName = isZhLocale
        ? (state.meta?.name.zh || state.meta?.name.en || state.templateId)
        : (state.meta?.name.en || state.meta?.name.zh || state.templateId)
      const localizedSummary = isZhLocale
        ? (state.meta?.summary.zh || state.meta?.summary.en || '')
        : (state.meta?.summary.en || state.meta?.summary.zh || '')
      const localizedTags = isZhLocale
        ? (state.meta?.tags.zh?.length ? state.meta.tags.zh : (state.meta?.tags.en || []))
        : (state.meta?.tags.en?.length ? state.meta.tags.en : (state.meta?.tags.zh || []))
      const categoryLabel = locale.value === 'zh-CN'
        ? (state.meta?.category.label.zh || state.meta?.category.label.en || state.meta?.category.key || '')
        : (state.meta?.category.label.en || state.meta?.category.label.zh || state.meta?.category.key || '')

      return {
        effectPackageId: state.effectPackageId,
        templateId: state.templateId,
        packageVersion: state.packageVersion,
        catalogVersion: state.catalogVersion,
        status: state.status,
        displayName: localizedName,
        searchTokens: [
          state.meta?.name.zh || '',
          state.meta?.name.en || '',
          localizedSummary,
          state.meta?.summary.zh || '',
          state.meta?.summary.en || '',
          categoryLabel,
          ...localizedTags,
        ],
        categoryKey: state.meta?.category.key || 'uncategorized',
        categoryLabel,
        durationFrames: state.meta?.transitionDurationFrames,
      }
    })
    .sort((a, b) => a.displayName.localeCompare(b.displayName, locale.value === 'zh-CN' ? 'zh-CN' : 'en')),
)

const categoryTabs = computed(() => {
  const unique = new Map<string, string>()
  for (const item of items.value) {
    if (!unique.has(item.categoryKey)) {
      unique.set(item.categoryKey, item.categoryLabel || item.categoryKey)
    }
  }

  return [
    {
      key: 'all',
      label: t('media.all'),
      icon: IconComponents.GRID,
    },
    ...Array.from(unique.entries())
      .sort((a, b) => a[1].localeCompare(b[1], locale.value === 'zh-CN' ? 'zh-CN' : 'en'))
      .map(([key, label]) => ({
        key,
        label,
        icon: getEffectTypeIcon(props.effectType),
      })),
  ]
})

const activeCategoryKey = computed(() =>
  unifiedStore.effectTemplateCategorySelection[props.effectType] || 'all',
)

watch(categoryTabs, (tabs) => {
  if (!tabs.some((tab) => tab.key === activeCategoryKey.value)) {
    unifiedStore.setEffectTemplateCategory(props.effectType, 'all')
  }
}, { immediate: true })

const filteredItems = computed(() => {
  const keyword = search.value.trim().toLowerCase()

  return items.value.filter((item) => {
    if (activeCategoryKey.value !== 'all' && item.categoryKey !== activeCategoryKey.value) {
      return false
    }

    if (!keyword) {
      return true
    }

    return item.searchTokens.some((token) => token.toLowerCase().includes(keyword))
  })
})

function handleCategorySelect(categoryKey: string): void {
  unifiedStore.setEffectTemplateCategory(props.effectType, categoryKey)
}

function canDrag(item: DisplayItem): boolean {
  return item.status === 'ready' || item.status === 'installed'
}

function canInstall(item: DisplayItem): boolean {
  return item.status === 'remote' || item.status === 'error' || item.status === 'missing'
}

function getStatusTone(item: DisplayItem): 'processing' | 'error' | 'idle' {
  if (item.status === 'error' || item.status === 'missing') {
    return 'error'
  }
  if (item.status === 'installing' || item.status === 'loading') {
    return 'processing'
  }
  return 'idle'
}

function getStatusIcon(item: DisplayItem) {
  switch (item.status) {
    case 'remote':
      return IconComponents.DOWNLOAD
    case 'installing':
    case 'loading':
      return IconComponents.LOADING
    case 'error':
    case 'missing':
      return IconComponents.WARNING
    case 'installed':
    case 'ready':
      return IconComponents.CHECK
    default:
      return IconComponents.SPARKLING
  }
}

async function handleItemClick(item: DisplayItem): Promise<void> {
  if (!canInstall(item)) {
    return
  }

  try {
    await effectTemplateRegistry.installTemplate(
      props.effectType,
      item.templateId,
      item.packageVersion,
      item.catalogVersion,
    )
  } catch (error) {
    unifiedStore.messageError(error instanceof Error ? error.message : String(error))
  }
}

function handleDragStart(event: DragEvent, item: DisplayItem): void {
  if (!event.dataTransfer || !canDrag(item)) {
    event.preventDefault()
    return
  }

  const dragData: MediaItemDragData = {
    sourceType: DragSourceType.ASSET,
    timestamp: Date.now(),
    assetIds: [item.effectPackageId],
    assetId: item.effectPackageId,
    name: item.displayName,
    assetKind: 'effect-template',
    effectType: props.effectType,
    effectPackageId: item.effectPackageId,
    templateId: item.templateId,
    packageVersion: item.packageVersion,
    catalogVersion: item.catalogVersion,
    duration: item.durationFrames,
  }

  unifiedStore.startDrag(event, dragData)
}
</script>

<style scoped>
.effect-template-library {
  height: 100%;
  display: flex;
  flex-direction: column;
  background:
    linear-gradient(180deg, rgba(255, 255, 255, 0.02), transparent),
    var(--color-bg-secondary);
}

.effect-template-library__toolbar {
  display: flex;
  align-items: center;
  padding: 10px;
  border-bottom: 1px solid var(--color-border-primary);
  background: var(--color-bg-tertiary);
}

.effect-template-library__search {
  flex: 1;
  min-width: 0;
  height: 34px;
  border: 1px solid var(--color-border-secondary);
  border-radius: 10px;
  background: var(--color-bg-secondary);
  color: var(--color-text-secondary);
  padding: 0 10px;
  display: flex;
  align-items: center;
  gap: 8px;
}

.effect-template-library__search input {
  flex: 1;
  min-width: 0;
  background: transparent;
  border: none;
  color: var(--color-text-primary);
  outline: none;
}

.effect-template-library__empty {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-direction: column;
  gap: 10px;
  color: var(--color-text-secondary);
}

.effect-template-library__empty p {
  margin: 0;
}

.effect-template-library__grid {
  flex: 1;
  overflow: auto;
  display: grid;
  align-content: start;
  padding: var(--spacing-sm);
}

.effect-template-library__grid--large-icon {
  grid-template-columns: repeat(auto-fill, minmax(140px, 1fr));
  gap: var(--spacing-md);
}

.effect-template-library__grid--medium-icon {
  grid-template-columns: repeat(auto-fill, minmax(100px, 1fr));
  gap: var(--spacing-sm);
}

.effect-template-library__grid--small-icon {
  grid-template-columns: repeat(auto-fill, minmax(70px, 1fr));
  gap: var(--spacing-xs);
}

.effect-template-item {
  border: 1px solid transparent;
  border-radius: var(--border-radius-small);
  background: transparent;
  color: var(--color-text-primary);
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 4px;
  cursor: default;
  transition: all var(--transition-fast);
}

.effect-template-item.is-clickable,
.effect-template-item.is-draggable {
  cursor: pointer;
}

.effect-template-item:hover {
  background-color: rgba(255, 255, 255, 0.05);
}

.effect-template-item__icon {
  width: 64px;
  height: 64px;
  display: flex;
  align-items: center;
  justify-content: center;
  margin-bottom: 4px;
  border-radius: 10px;
  position: relative;
}

.effect-template-library__grid--large-icon .effect-template-item__icon {
  width: 120px;
  height: 120px;
}

.effect-template-library__grid--medium-icon .effect-template-item__icon {
  width: 80px;
  height: 80px;
}

.effect-template-library__grid--small-icon .effect-template-item__icon {
  width: 48px;
  height: 48px;
}

.effect-template-item__icon--transition {
  background: linear-gradient(135deg, rgba(255, 173, 66, 0.18), rgba(255, 110, 64, 0.08));
  border: 1px solid rgba(255, 173, 66, 0.22);
  color: #ffb36b;
}

.effect-template-item__icon--filter {
  background: linear-gradient(135deg, rgba(102, 191, 255, 0.18), rgba(32, 114, 255, 0.08));
  border: 1px solid rgba(102, 191, 255, 0.22);
  color: #86caff;
}

.effect-template-item__name {
  width: 100%;
  max-width: 90px;
  padding: 2px;
  border-radius: 2px;
  text-align: center;
  font-size: var(--font-size-xs);
  line-height: 1.2;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.effect-template-library__grid--large-icon .effect-template-item__name {
  max-width: 130px;
  font-size: var(--font-size-sm);
}

.effect-template-library__grid--small-icon .effect-template-item__name {
  max-width: 60px;
}

.effect-template-item__status {
  position: absolute;
  top: 6px;
  right: 6px;
  width: 18px;
  height: 18px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 999px;
  background: rgba(15, 15, 15, 0.72);
  color: var(--color-text-secondary);
  backdrop-filter: blur(4px);
}

.effect-template-item__status--processing {
  color: #ffcf9a;
}

.effect-template-item__status--error {
  color: #ff9e9e;
}

.effect-template-item__status--idle {
  color: var(--color-text-primary);
}

.effect-template-item__status--ready::after {
  content: '';
  position: absolute;
  left: 5px;
  right: 5px;
  bottom: 4px;
  height: 1px;
  border-radius: 999px;
  background: currentColor;
}

.effect-template-item__status-icon--spin {
  animation: effect-template-spin 1s linear infinite;
}

.effect-template-library__list {
  flex: 1;
  overflow: auto;
  display: flex;
  flex-direction: column;
  padding: var(--spacing-sm);
  gap: 2px;
}

.effect-template-list-item {
  border: 1px solid transparent;
  border-radius: var(--border-radius-small);
  background: transparent;
  color: var(--color-text-primary);
  display: grid;
  grid-template-columns: 40px 1fr;
  align-items: center;
  gap: var(--spacing-sm);
  padding: var(--spacing-xs) var(--spacing-sm);
  cursor: default;
  transition: all var(--transition-fast);
}

.effect-template-list-item.is-clickable,
.effect-template-list-item.is-draggable {
  cursor: pointer;
}

.effect-template-list-item:hover {
  background-color: rgba(255, 255, 255, 0.05);
}

.effect-template-list-item__icon {
  width: 32px;
  height: 32px;
  border-radius: 8px;
  display: flex;
  align-items: center;
  justify-content: center;
  position: relative;
}

.effect-template-list-item__icon--transition {
  background: linear-gradient(135deg, rgba(255, 173, 66, 0.18), rgba(255, 110, 64, 0.08));
  color: #ffb36b;
}

.effect-template-list-item__icon--filter {
  background: linear-gradient(135deg, rgba(102, 191, 255, 0.18), rgba(32, 114, 255, 0.08));
  color: #86caff;
}

.effect-template-list-item__name {
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  text-align: left;
  font-size: var(--font-size-base);
}

@keyframes effect-template-spin {
  from {
    transform: rotate(0deg);
  }
  to {
    transform: rotate(360deg);
  }
}
</style>
