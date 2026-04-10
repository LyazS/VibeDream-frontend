<template>
  <UniversalModal
    :show="show"
    :title="t('media.transitionTemplatePickerTitle')"
    :show-footer="false"
    :show-confirm="false"
    :show-cancel="false"
    width="880px"
    max-width="92vw"
    max-height="85vh"
    @update:show="emit('update:show', $event)"
    @close="emit('close')"
  >
    <div class="transition-template-picker">
      <div v-if="cacheNotice" class="transition-template-picker__notice">
        {{ cacheNotice }}
      </div>

      <div v-if="isLoading" class="transition-template-picker__state">
        <component :is="IconComponents.LOADING" size="22px" class="transition-template-picker__spin" />
        <span>{{ t('media.transitionTemplateLoading') }}</span>
      </div>

      <div v-else-if="loadError" class="transition-template-picker__state transition-template-picker__state--error">
        <component :is="IconComponents.ERROR" size="20px" />
        <span>{{ loadError }}</span>
        <HoverButton variant="large" @click="void loadCatalog()">
          {{ t('media.transitionTemplateRetry') }}
        </HoverButton>
      </div>

      <div v-else-if="items.length === 0" class="transition-template-picker__state">
        <component :is="IconComponents.EMPTY" size="22px" />
        <span>{{ t('media.transitionTemplateEmpty') }}</span>
      </div>

      <div v-else class="transition-template-picker__grid">
        <button
          v-for="item in items"
          :key="item.id"
          type="button"
          class="transition-template-picker__card"
          :disabled="creatingTemplateId === item.id || !directoryId"
          @click="void handleTemplateSelect(item.id)"
        >
          <div class="transition-template-picker__cover">
            <img
              v-if="item.cover_url"
              :src="item.cover_url"
              :alt="resolveLocalizedText(item.name)"
              class="transition-template-picker__cover-image"
            />
            <div v-else class="transition-template-picker__cover-fallback">
              <component :is="IconComponents.SPARKLING" size="26px" />
            </div>
          </div>

          <div class="transition-template-picker__body">
            <div class="transition-template-picker__title-row">
              <strong class="transition-template-picker__title">
                {{ resolveLocalizedText(item.name) }}
              </strong>
              <component
                v-if="creatingTemplateId === item.id"
                :is="IconComponents.LOADING"
                size="16px"
                class="transition-template-picker__spin"
              />
            </div>
            <p class="transition-template-picker__summary">
              {{ resolveLocalizedText(item.summary) || t('media.transitionTemplateNoSummary') }}
            </p>
            <div v-if="resolveLocalizedTags(item.tags).length > 0" class="transition-template-picker__tags">
              <span
                v-for="tag in resolveLocalizedTags(item.tags)"
                :key="tag"
                class="transition-template-picker__tag"
              >
                {{ tag }}
              </span>
            </div>
          </div>
        </button>
      </div>
    </div>
  </UniversalModal>
</template>

<script setup lang="ts">
import { ref, watch } from 'vue'
import UniversalModal from '@/components/modals/UniversalModal.vue'
import HoverButton from '@/components/base/HoverButton.vue'
import { IconComponents } from '@/constants/iconComponents'
import { useAppI18n } from '@/core/composables/useI18n'
import { useUnifiedStore } from '@/core/unifiedStore'
import type {
  LocalizedTagList,
  LocalizedText,
  TransitionTemplateSummary,
} from '@/core/effect-template/catalogTypes'
import { TransitionTemplateCatalogCacheManager } from '@/core/effect-template/TransitionTemplateCatalogCacheManager'
import { transitionTemplateCatalogService } from '@/core/effect-template/TransitionTemplateCatalogService'

interface Props {
  show: boolean
  directoryId: string | null
}

const props = defineProps<Props>()

const emit = defineEmits<{
  'update:show': [value: boolean]
  close: []
}>()

const unifiedStore = useUnifiedStore()
const { t, locale } = useAppI18n()

const items = ref<TransitionTemplateSummary[]>([])
const catalogVersion = ref('')
const isLoading = ref(false)
const loadError = ref('')
const cacheNotice = ref('')
const loadedFromCache = ref(false)
const creatingTemplateId = ref<string | null>(null)

watch(
  () => props.show,
  (nextShow) => {
    if (nextShow) {
      void loadCatalog()
    } else {
      creatingTemplateId.value = null
    }
  },
)

async function loadCatalog(forceRefresh: boolean = false): Promise<void> {
  isLoading.value = true
  loadError.value = ''
  cacheNotice.value = ''

  const cachedCatalog = TransitionTemplateCatalogCacheManager.loadCatalog()

  try {
    const versionData = await transitionTemplateCatalogService.getCatalogVersion()
    if (!forceRefresh && cachedCatalog && cachedCatalog.version === versionData.catalog_version) {
      items.value = cachedCatalog.items
      catalogVersion.value = cachedCatalog.version
      loadedFromCache.value = true
      return
    }

    const catalogData = await transitionTemplateCatalogService.getTemplateSummaries()
    items.value = catalogData.items
    catalogVersion.value = catalogData.catalog_version
    loadedFromCache.value = false
    TransitionTemplateCatalogCacheManager.saveCatalog(catalogData.catalog_version, catalogData.items)
  } catch (error) {
    if (cachedCatalog) {
      items.value = cachedCatalog.items
      catalogVersion.value = cachedCatalog.version
      loadedFromCache.value = true
      cacheNotice.value = t('media.transitionTemplateCacheFallback')
      return
    }

    items.value = []
    catalogVersion.value = ''
    loadedFromCache.value = false
    loadError.value = t('media.transitionTemplateLoadFailed', {
      error: error instanceof Error ? error.message : String(error),
    })
  } finally {
    isLoading.value = false
  }
}

async function handleTemplateSelect(templateId: string): Promise<void> {
  if (!props.directoryId) {
    unifiedStore.messageError(t('media.selectDirectoryFirst'))
    return
  }

  creatingTemplateId.value = templateId
  try {
    const template = items.value.find((item) => item.id === templateId)
    if (!template) {
      throw new Error('模板不存在')
    }

    const asset = unifiedStore.createTransitionTemplatePlaceholder({
      templateId,
      name: resolveLocalizedText(template.name),
      catalogVersion: catalogVersion.value || undefined,
    })
    unifiedStore.addAsset(asset)
    unifiedStore.addAssetToDirectory(asset.id, props.directoryId)
    void unifiedStore.startTemplateProcessing(asset.id)
    unifiedStore.messageSuccess(
      t('media.transitionTemplateCreated', {
        name: asset.name,
      }),
    )
    emit('update:show', false)
    emit('close')
  } catch (error) {
    unifiedStore.messageError(
      t('media.transitionTemplateCreateFailed', {
        error: error instanceof Error ? error.message : String(error),
      }),
    )
  } finally {
    creatingTemplateId.value = null
  }
}

function resolveLocalizedText(value: LocalizedText): string {
  return locale.value === 'zh-CN' ? value.zh || value.en : value.en || value.zh
}

function resolveLocalizedTags(value: LocalizedTagList): string[] {
  const tags = locale.value === 'zh-CN' ? value.zh : value.en
  if (tags.length > 0) {
    return tags
  }
  return locale.value === 'zh-CN' ? value.en : value.zh
}
</script>

<style scoped>
.transition-template-picker {
  display: flex;
  flex-direction: column;
  gap: var(--spacing-lg);
  min-height: 320px;
}

.transition-template-picker__notice {
  background: color-mix(in srgb, var(--color-bg-secondary) 88%, #f2b100 12%);
  border: 1px solid var(--color-border-primary);
  border-radius: var(--border-radius-medium);
  color: var(--color-text-primary);
  padding: var(--spacing-sm) var(--spacing-md);
}

.transition-template-picker__state {
  min-height: 260px;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-direction: column;
  gap: var(--spacing-md);
  color: var(--color-text-secondary);
  text-align: center;
}

.transition-template-picker__state--error {
  color: #ff8f8f;
}

.transition-template-picker__grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(240px, 1fr));
  gap: var(--spacing-lg);
  max-height: 56vh;
  overflow-y: auto;
  padding-right: var(--spacing-xs);
}

.transition-template-picker__card {
  background: var(--color-bg-secondary);
  border: 1px solid var(--color-border-primary);
  border-radius: var(--border-radius-large);
  color: inherit;
  cursor: pointer;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  padding: 0;
  text-align: left;
  transition: border-color var(--transition-fast);
}

.transition-template-picker__card:hover:not(:disabled) {
  border-color: var(--color-text-secondary);
}

.transition-template-picker__card:disabled {
  cursor: not-allowed;
  opacity: 0.7;
}

.transition-template-picker__cover {
  position: relative;
  height: 138px;
  background:
    radial-gradient(circle at top left, rgba(255, 215, 128, 0.2), transparent 55%),
    linear-gradient(135deg, rgba(255, 255, 255, 0.05), rgba(255, 255, 255, 0.01));
}

.transition-template-picker__cover-image {
  width: 100%;
  height: 100%;
  display: block;
  object-fit: cover;
}

.transition-template-picker__cover-fallback {
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #f5d27a;
}

.transition-template-picker__body {
  display: flex;
  flex-direction: column;
  gap: var(--spacing-sm);
  padding: var(--spacing-lg);
}

.transition-template-picker__title-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--spacing-sm);
}

.transition-template-picker__title {
  color: var(--color-text-primary);
  font-size: 15px;
}

.transition-template-picker__summary {
  margin: 0;
  color: var(--color-text-secondary);
  font-size: var(--font-size-sm);
  line-height: 1.5;
  min-height: 42px;
}

.transition-template-picker__tags {
  display: flex;
  flex-wrap: wrap;
  gap: var(--spacing-xs);
}

.transition-template-picker__tag {
  border-radius: 999px;
  background: var(--color-bg-quaternary);
  color: var(--color-text-secondary);
  padding: 2px 8px;
  font-size: 12px;
}

.transition-template-picker__spin {
  animation: transition-template-picker-spin 1s linear infinite;
}

@keyframes transition-template-picker-spin {
  from {
    transform: rotate(0deg);
  }

  to {
    transform: rotate(360deg);
  }
}

@media (max-width: 720px) {
  .transition-template-picker__grid {
    grid-template-columns: 1fr;
  }
}
</style>
