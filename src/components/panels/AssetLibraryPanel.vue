<template>
  <div class="asset-library-panel">
    <n-tabs
      :value="currentSection"
      type="line"
      animated
      class="asset-library-panel__tabs"
      @update:value="switchSection"
    >
      <n-tab
        v-for="section in sections"
        :key="section.key"
        :name="section.key"
        :tab="section.label"
      />
    </n-tabs>

    <div class="asset-library-panel__content">
      <VirtualDirectory v-if="currentSection === 'media'" />
      <LibrarySectionPlaceholder
        v-else-if="currentSection === 'transition'"
        :icon="IconComponents.EFFECT_TRANSITION"
        :title="t('media.sections.transitionPlaceholderTitle')"
        :description="t('media.sections.transitionPlaceholderDescription')"
      />
      <LibrarySectionPlaceholder
        v-else
        :icon="IconComponents.EFFECT_FILTER"
        :title="t('media.sections.filterPlaceholderTitle')"
        :description="t('media.sections.filterPlaceholderDescription')"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { NTab, NTabs } from 'naive-ui'
import type { LibrarySectionKey } from '@/core/modules/UnifiedUIModule'
import { useUnifiedStore } from '@/core/unifiedStore'
import { useAppI18n } from '@/core/composables/useI18n'
import { IconComponents } from '@/constants/iconComponents'
import VirtualDirectory from './VirtualDirectory.vue'
import LibrarySectionPlaceholder from './LibrarySectionPlaceholder.vue'

const unifiedStore = useUnifiedStore()
const { t } = useAppI18n()

const currentSection = computed(() => unifiedStore.librarySection)

const sections = computed<Array<{ key: LibrarySectionKey; label: string }>>(() => [
  { key: 'media', label: t('media.sections.media') },
  { key: 'transition', label: t('media.sections.transition') },
  { key: 'filter', label: t('media.sections.filter') },
])

function switchSection(section: LibrarySectionKey): void {
  unifiedStore.setLibrarySection(section)
}
</script>

<style scoped>
.asset-library-panel {
  width: 100%;
  height: 100%;
  display: flex;
  flex-direction: column;
  background-color: var(--color-bg-secondary);
  border-radius: 4px;
  overflow: hidden;
}

.asset-library-panel__tabs {
  flex-shrink: 0;
  padding: 0 10px;
  border-bottom: 1px solid var(--color-border-primary);
  background:
    linear-gradient(180deg, rgba(255, 255, 255, 0.03), transparent),
    var(--color-bg-tertiary);
}

.asset-library-panel__tabs:deep(.n-tabs-nav) {
  padding: 0;
}

.asset-library-panel__tabs:deep(.n-tabs-tab) {
  padding: 8px 0 7px;
  font-size: 12px;
  font-weight: 600;
}

.asset-library-panel__tabs:deep(.n-tabs-nav-scroll-wrapper) {
  min-height: 34px;
}

.asset-library-panel__tabs:deep(.n-tabs-bar) {
  height: 2px;
}

.asset-library-panel__content {
  flex: 1;
  min-height: 0;
}
</style>
