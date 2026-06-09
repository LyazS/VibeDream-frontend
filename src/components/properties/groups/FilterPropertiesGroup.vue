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

      <div
        v-if="dynamicFilterParamSchemas.length > 0"
        class="filter-properties-group__dynamic-params"
      >
        <KeyframedSliderField
          v-for="schema in dynamicFilterParamSchemas"
          :key="schema.propertyId"
          :label="schema.label ?? schema.propertyId"
          :state="getFilterChannelButtonState(getFilterParamChannel(schema))"
          :tooltip="getFilterKeyframeTooltip(getFilterParamChannel(schema))"
          :disabled="!canOperateFilterNumbers || !isFilterReady"
          :has-previous="hasPreviousFilterKeyframe(getFilterParamChannel(schema))"
          :has-next="hasNextFilterKeyframe(getFilterParamChannel(schema))"
          :value="getFilterParamNumberValue(schema)"
          :min="schema.min ?? 0"
          :max="schema.max ?? 1"
          :step="schema.step ?? 0.01"
          :precision="2"
          @slider-input="(value) => setFilterParamDeferred(getFilterParamKey(schema), value)"
          @slider-change="void commitDeferredUpdates()"
          @number-change="(value) => void setFilterParamDirect(getFilterParamKey(schema), value)"
          @previous="goToPreviousFilterKeyframe(getFilterParamChannel(schema))"
          @toggle="void toggleFilterKeyframe(getFilterParamChannel(schema))"
          @next="goToNextFilterKeyframe(getFilterParamChannel(schema))"
        />
      </div>
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
import {
  propertySchemaResolver,
  type AnimatablePropertySchema,
} from '@/core/property-system/schema'
import type { UnifiedTimelineItemData } from '@/core/timelineitem/type'
import type { FilterChannelKey } from '@/core/composables/filterControls/types'

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
  setFilterParamDeferred,
  setFilterParamDirect,
  commitDeferredUpdates,
  cancelDeferredUpdates,
} = useUnifiedFilterControls({
  selectedTimelineItem,
  currentFrame,
})

const currentEffectPackageId = computed(() => filterEffect.value?.effectPackageId)
const dynamicFilterParamSchemas = computed(() => {
  const item = selectedTimelineItem.value
  if (!item || !hasFilterEffect.value) {
    return []
  }

  return propertySchemaResolver
    .listSchemas({
      item,
      frame: currentFrame.value,
    })
    .filter((schema) =>
      schema.propertyId.startsWith('filter.param.') &&
      schema.valueKind === 'number',
    )
})
const isFilterReady = computed(() => {
  if (!currentEffectPackageId.value) {
    return false
  }
  return effectTemplateRegistry.getPackageState(currentEffectPackageId.value)?.status === 'ready'
})

function getFilterParamKey(schema: AnimatablePropertySchema): string {
  return schema.propertyId.slice('filter.param.'.length)
}

function getFilterParamChannel(schema: AnimatablePropertySchema): FilterChannelKey {
  return `filter.param.${getFilterParamKey(schema)}`
}

function getFilterParamNumberValue(schema: AnimatablePropertySchema): number {
  const parameterKey = getFilterParamKey(schema)
  const currentValue = filterConfig.value.params[parameterKey]
  if (typeof currentValue === 'number' && Number.isFinite(currentValue)) {
    return currentValue
  }
  const defaultValue = filterEffect.value?.packagePayload.defaultParams[parameterKey]
  if (typeof defaultValue === 'number' && Number.isFinite(defaultValue)) {
    return defaultValue
  }
  return schema.min ?? 0
}

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

.filter-properties-group__dynamic-params {
  display: flex;
  flex-direction: column;
  gap: var(--spacing-md);
  margin-top: var(--spacing-md);
}

.filter-properties-group__slider-value {
  min-width: 48px;
  text-align: right;
  color: var(--color-text-secondary);
  font-size: var(--font-size-sm);
}
</style>
