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
              <component :is="getEffectTypeIcon('transition')" size="26px" />
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
import { IconComponents, getEffectTypeIcon } from '@/constants/iconComponents'
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

<style scoped src="./TransitionTemplatePickerModal.shared.css"></style>
