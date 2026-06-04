<template>
  <div class="effect-template-library">
    <div class="effect-template-library__toolbar">
      <input
        v-model="search"
        class="effect-template-library__search"
        :placeholder="effectType === 'transition' ? '搜索转场' : '搜索滤镜'"
      />
    </div>

    <div class="effect-template-library__grid">
      <button
        v-for="item in filteredItems"
        :key="item.effectPackageId"
        class="effect-template-card"
        :class="`effect-template-card--${item.status}`"
        :draggable="item.status === 'ready'"
        @click="void handleCardClick(item)"
        @dragstart="handleDragStart($event, item)"
      >
        <div class="effect-template-card__icon">
          <component
            :is="effectType === 'transition' ? IconComponents.TOOLS_FILL : IconComponents.SPARKLING"
            size="22px"
          />
        </div>
        <div class="effect-template-card__body">
          <div class="effect-template-card__title">{{ item.displayName }}</div>
          <div class="effect-template-card__meta">
            <span>{{ item.packageVersion }}</span>
            <span>{{ item.status }}</span>
          </div>
          <div v-if="item.summary" class="effect-template-card__summary">{{ item.summary }}</div>
          <div class="effect-template-card__tags">
            <span v-for="tag in item.tags.slice(0, 3)" :key="tag" class="effect-template-card__tag">
              {{ tag }}
            </span>
          </div>
        </div>
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { IconComponents } from '@/constants/iconComponents'
import { effectTemplateRegistry } from '@/core/effect-template/EffectTemplateRegistry'
import type { CommonEffectType } from '@/core/effect-template/commonTypes'
import { DragSourceType, type MediaItemDragData } from '@/core/types/drag'
import { useUnifiedStore } from '@/core/unifiedStore'

interface Props {
  effectType: CommonEffectType
}

interface DisplayItem {
  effectPackageId: string
  templateId: string
  packageVersion: string
  catalogVersion: string
  status: string
  displayName: string
  summary: string
  tags: string[]
}

const props = defineProps<Props>()
const unifiedStore = useUnifiedStore()
const search = ref('')

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
    .map((state) => ({
      effectPackageId: state.effectPackageId,
      templateId: state.templateId,
      packageVersion: state.packageVersion,
      catalogVersion: state.catalogVersion,
      status: state.status,
      displayName:
        state.meta?.name.zh ||
        state.meta?.name.en ||
        state.templateId,
      summary: state.meta?.summary.zh || state.meta?.summary.en || '',
      tags: state.meta?.tags.zh?.length ? state.meta.tags.zh : (state.meta?.tags.en || []),
    })),
)

const filteredItems = computed(() => {
  const keyword = search.value.trim().toLowerCase()
  if (!keyword) {
    return items.value
  }

  return items.value.filter((item) =>
    item.displayName.toLowerCase().includes(keyword)
    || item.summary.toLowerCase().includes(keyword)
    || item.tags.some((tag) => tag.toLowerCase().includes(keyword)),
  )
})

async function handleCardClick(item: DisplayItem): Promise<void> {
  if (item.status === 'ready' || item.status === 'installing') {
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
  const loaded = effectTemplateRegistry.getReadyPackage(item.effectPackageId)
  if (!loaded || !event.dataTransfer) {
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
    templatePayload: loaded.payload,
    effectPackageId: item.effectPackageId,
    templateId: item.templateId,
    packageVersion: item.packageVersion,
    catalogVersion: item.catalogVersion,
  }

  unifiedStore.startDrag(event, dragData)
}
</script>

<style scoped>
.effect-template-library {
  height: 100%;
  display: flex;
  flex-direction: column;
  background: linear-gradient(180deg, rgba(255, 255, 255, 0.02), transparent);
}

.effect-template-library__toolbar {
  padding: 10px;
  border-bottom: 1px solid var(--color-border-primary);
}

.effect-template-library__search {
  width: 100%;
  height: 34px;
  border: 1px solid var(--color-border-secondary);
  border-radius: 10px;
  background: var(--color-bg-tertiary);
  color: var(--color-text-primary);
  padding: 0 12px;
  outline: none;
}

.effect-template-library__grid {
  flex: 1;
  overflow: auto;
  padding: 12px;
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
  gap: 12px;
}

.effect-template-card {
  border: 1px solid var(--color-border-secondary);
  border-radius: 14px;
  background: var(--color-bg-tertiary);
  color: inherit;
  text-align: left;
  padding: 14px;
  display: flex;
  gap: 12px;
  cursor: pointer;
}

.effect-template-card--installing {
  cursor: default;
}

.effect-template-card__icon {
  width: 42px;
  height: 42px;
  border-radius: 12px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: color-mix(in srgb, var(--color-accent-primary) 18%, transparent);
}

.effect-template-card__body {
  min-width: 0;
  flex: 1;
}

.effect-template-card__title {
  font-size: 13px;
  font-weight: 600;
  color: var(--color-text-primary);
}

.effect-template-card__meta,
.effect-template-card__summary {
  margin-top: 6px;
  font-size: 12px;
  color: var(--color-text-secondary);
}

.effect-template-card__meta {
  display: flex;
  gap: 8px;
}

.effect-template-card__tags {
  margin-top: 8px;
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.effect-template-card__tag {
  font-size: 11px;
  padding: 2px 8px;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.06);
  color: var(--color-text-secondary);
}

.effect-template-card--error,
.effect-template-card--missing {
  border-color: rgba(255, 107, 107, 0.45);
}

.effect-template-card--ready {
  border-color: rgba(74, 222, 128, 0.35);
}
</style>
