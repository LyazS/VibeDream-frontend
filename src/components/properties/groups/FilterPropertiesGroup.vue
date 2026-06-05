<template>
  <div class="filter-properties-group">
    <div class="property-section">
      <h4>{{ t('properties.filter.title') }}</h4>

      <FilterEffectDropZone
        :timeline-item-id="selectedTimelineItem.id"
        :effect-package-id="currentEffectPackageId"
        @remove="void handleRemove()"
      />

      <KeyframedSliderField
        v-if="hasFilterEffect"
        class="filter-properties-group__intensity"
        :label="t('properties.filter.intensity')"
        :state="getFilterChannelButtonState()"
        :tooltip="getFilterKeyframeTooltip()"
        :disabled="!canOperateFilterNumbers || !isFilterReady"
        :has-previous="hasPreviousFilterKeyframe()"
        :has-next="hasNextFilterKeyframe()"
        :value="filterConfig.intensity"
        :min="0"
        :max="1"
        :step="0.01"
        :precision="2"
        @slider-input="setFilterIntensityDeferred"
        @slider-change="void commitDeferredUpdates()"
        @number-change="(value) => void setFilterIntensityDirect(value)"
        @previous="goToPreviousFilterKeyframe()"
        @toggle="void toggleFilterKeyframe()"
        @next="goToNextFilterKeyframe()"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import FilterEffectDropZone from '@/components/properties/groups/FilterEffectDropZone.vue'
import KeyframedSliderField from '@/components/properties/common/KeyframedSliderField.vue'
import { useAppI18n, useUnifiedFilterControls } from '@/core/composables'
import { effectTemplateRegistry } from '@/core/effect-template/EffectTemplateRegistry'
import { useUnifiedStore } from '@/core/unifiedStore'
import type { UnifiedTimelineItemData } from '@/core/timelineitem/type'

interface Props {
  selectedTimelineItem: UnifiedTimelineItemData<'video'> | UnifiedTimelineItemData<'image'>
  currentFrame: number
}

const props = defineProps<Props>()
const { t } = useAppI18n()
const unifiedStore = useUnifiedStore()
const selectedTimelineItem = computed(() => props.selectedTimelineItem)
const currentFrame = computed(() => props.currentFrame)

const {
  filterEffect,
  filterConfig,
  hasFilterEffect,
  canOperateFilterNumbers,
  getFilterChannelButtonState,
  hasPreviousFilterKeyframe,
  hasNextFilterKeyframe,
  getFilterKeyframeTooltip,
  toggleFilterKeyframe,
  goToPreviousFilterKeyframe,
  goToNextFilterKeyframe,
  setFilterIntensityDeferred,
  setFilterIntensityDirect,
  commitDeferredUpdates,
  cancelDeferredUpdates,
} = useUnifiedFilterControls({
  selectedTimelineItem,
  currentFrame,
})

const currentEffectPackageId = computed(() => filterEffect.value?.effectPackageId)
const isFilterReady = computed(() => {
  if (!currentEffectPackageId.value) {
    return false
  }
  return effectTemplateRegistry.getPackageState(currentEffectPackageId.value)?.status === 'ready'
})

async function handleRemove() {
  await cancelDeferredUpdates()
  unifiedStore.pause()
  await unifiedStore.removeFilterEffectWithHistory(props.selectedTimelineItem.id)
}
</script>

<style scoped>
.filter-properties-group {
  width: 100%;
}

.filter-properties-group__slider-row {
  display: flex;
  align-items: center;
  gap: 10px;
}

.filter-properties-group__intensity {
  margin-top: var(--spacing-md);
}

.filter-properties-group__slider-value {
  min-width: 48px;
  text-align: right;
  color: var(--color-text-secondary);
  font-size: var(--font-size-sm);
}
</style>
