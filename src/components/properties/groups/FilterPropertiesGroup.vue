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
        v-if="hasFilterConfig"
        class="filter-properties-group__intensity"
        :label="t('properties.filter.intensity')"
        :state="getFilterChannelButtonState()"
        :tooltip="getFilterKeyframeTooltip()"
        :disabled="!canOperateFilterNumbers || !isFilterReady"
        :has-previous="hasPreviousFilterKeyframe()"
        :has-next="hasNextFilterKeyframe()"
        :value="normalizedFilterConfig.intensity"
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
        v-if="dynamicFilterParamViewModels.length > 0"
        class="filter-properties-group__dynamic-params"
      >
        <template
          v-for="param in dynamicFilterParamViewModels"
          :key="param.propertyId"
        >
          <KeyframedSliderField
            v-if="param.kind === 'float' || param.kind === 'int'"
            :label="param.label"
            :state="getFilterChannelButtonState(param.channelKey)"
            :tooltip="getFilterKeyframeTooltip(param.channelKey)"
            :disabled="!canOperateFilterNumbers || !isFilterReady"
            :has-previous="hasPreviousFilterKeyframe(param.channelKey)"
            :has-next="hasNextFilterKeyframe(param.channelKey)"
            :value="param.value"
            :min="param.min"
            :max="param.max"
            :step="param.step"
            :precision="param.precision"
            @slider-input="(value) => setFilterParamDeferred(param.parameterKey, getNextScalarParamValue(param.kind, value))"
            @slider-change="void commitDeferredUpdates()"
            @number-change="(value) => void setFilterParamDirect(param.parameterKey, getNextScalarParamValue(param.kind, value))"
            @previous="goToPreviousFilterKeyframe(param.channelKey)"
            @toggle="void toggleFilterKeyframe(param.channelKey)"
            @next="goToNextFilterKeyframe(param.channelKey)"
          />
          <KeyframedDualNumberField
            v-else-if="param.kind === 'vec2' || param.kind === 'ivec2'"
            :label="param.label"
            :state="getFilterChannelButtonState(param.channelKey)"
            :tooltip="getFilterKeyframeTooltip(param.channelKey)"
            :disabled="!canOperateFilterNumbers || !isFilterReady"
            :has-previous="hasPreviousFilterKeyframe(param.channelKey)"
            :has-next="hasNextFilterKeyframe(param.channelKey)"
            first-label="X"
            second-label="Y"
            :first-value="param.value.x"
            :second-value="param.value.y"
            :first-min="param.min"
            :first-max="param.max"
            :second-min="param.min"
            :second-max="param.max"
            :step="param.step"
            :precision="param.precision"
            @first-input="(value) => setFilterParamVec2Deferred(param.parameterKey, getNextFilterParamVec2Value(param.value, 'x', value, param.kind))"
            @second-input="(value) => setFilterParamVec2Deferred(param.parameterKey, getNextFilterParamVec2Value(param.value, 'y', value, param.kind))"
            @first-change="(value) => void setFilterParamVec2Direct(param.parameterKey, getNextFilterParamVec2Value(param.value, 'x', value, param.kind))"
            @second-change="(value) => void setFilterParamVec2Direct(param.parameterKey, getNextFilterParamVec2Value(param.value, 'y', value, param.kind))"
            @previous="goToPreviousFilterKeyframe(param.channelKey)"
            @toggle="void toggleFilterKeyframe(param.channelKey)"
            @next="goToNextFilterKeyframe(param.channelKey)"
          />
          <div
            v-else-if="param.kind === 'color'"
            class="filter-properties-group__color-field"
          >
            <label class="filter-properties-group__color-label">
              {{ param.label }}
            </label>
            <div class="filter-properties-group__color-control">
              <NColorPicker
                :value="getFilterParamColorCssValue(param.value)"
                :show-alpha="true"
                :modes="['hex']"
                :disabled="!canOperateFilterNumbers || !isFilterReady"
                @update:value="(value) => handleFilterParamColorInput(param.parameterKey, value)"
                @update:show="(show) => void handleFilterParamColorPanelShowChange(param.parameterKey, show)"
              />
              <KeyframeNavButtons
                :state="getFilterChannelButtonState(param.channelKey)"
                :tooltip="getFilterKeyframeTooltip(param.channelKey)"
                :disabled="!canOperateFilterNumbers || !isFilterReady"
                :has-previous="hasPreviousFilterKeyframe(param.channelKey)"
                :has-next="hasNextFilterKeyframe(param.channelKey)"
                @previous="goToPreviousFilterKeyframe(param.channelKey)"
                @toggle="void toggleFilterKeyframe(param.channelKey)"
                @next="goToNextFilterKeyframe(param.channelKey)"
              />
            </div>
          </div>
          <div
            v-else-if="param.kind === 'boolean'"
            class="filter-properties-group__boolean-row"
          >
            <label
              :for="`filter-param-${param.parameterKey}`"
              class="filter-properties-group__boolean-label"
            >
              {{ param.label }}
            </label>
            <input
              :id="`filter-param-${param.parameterKey}`"
              type="checkbox"
              :checked="param.value"
              :disabled="!canOperateFilterNumbers || !isFilterReady"
              class="filter-properties-group__boolean-input"
              @change="handleFilterParamBooleanChange(param.parameterKey, $event)"
            />
          </div>
        </template>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { NColorPicker } from 'naive-ui'
import FilterEffectDropZone from '@/components/properties/groups/FilterEffectDropZone.vue'
import KeyframedDualNumberField from '@/components/properties/common/KeyframedDualNumberField.vue'
import KeyframedSliderField from '@/components/properties/common/KeyframedSliderField.vue'
import KeyframeNavButtons from '@/components/properties/common/KeyframeNavButtons.vue'
import {
  colorToCssRgbaString,
  normalizeFilterParamColor,
  type FilterParamColorValue,
} from '@/core/filter/color'
import { useAppI18n, useUnifiedFilterControls } from '@/core/composables'
import { useDynamicFilterParamViewModels } from '@/core/composables/filterControls/useDynamicFilterParamViewModels'
import { effectTemplateRegistry } from '@/core/effect-template/EffectTemplateRegistry'
import { useUnifiedStore } from '@/core/unifiedStore'
import type { UnifiedTimelineItemData } from '@/core/timelineitem/model/timelineItem'
import type { FilterParamVec2Value } from '@/core/composables/filterControls/types'

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
  filterConfig,
  normalizedFilterConfig,
  hasFilterConfig,
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
  setFilterParamVec2Deferred,
  setFilterParamVec2Direct,
  setFilterParamBooleanDirect,
  setFilterParamColorDeferred,
  commitDeferredUpdates,
  cancelDeferredUpdates,
} = useUnifiedFilterControls({
  selectedTimelineItem,
  currentFrame,
})

const currentEffectPackageId = computed(() => filterConfig.value?.effectPackageId)
const dynamicFilterParamViewModels = useDynamicFilterParamViewModels({
  selectedTimelineItem,
  currentFrame,
  filterConfig: normalizedFilterConfig,
  hasFilterEffect: hasFilterConfig,
})
const isFilterReady = computed(() => {
  if (!currentEffectPackageId.value) {
    return false
  }
  return effectTemplateRegistry.getPackageState(currentEffectPackageId.value)?.status === 'ready'
})

function getNextFilterParamVec2Value(
  currentValue: FilterParamVec2Value,
  axis: 'x' | 'y',
  value: number,
  kind: 'vec2' | 'ivec2',
): FilterParamVec2Value {
  return {
    ...currentValue,
    [axis]: kind === 'ivec2' ? Math.round(value) : value,
  }
}

function getNextScalarParamValue(kind: 'float' | 'int', value: number): number {
  return kind === 'int' ? Math.round(value) : value
}

function handleFilterParamBooleanChange(parameterKey: string, event: Event) {
  const target = event.target
  if (!(target instanceof HTMLInputElement)) {
    return
  }

  void setFilterParamBooleanDirect(parameterKey, target.checked)
}

function getFilterParamColorCssValue(value: FilterParamColorValue): string {
  return colorToCssRgbaString(value)
}

function handleFilterParamColorInput(parameterKey: string, value: string) {
  setFilterParamColorDeferred(parameterKey, normalizeFilterParamColor(value))
}

async function handleFilterParamColorPanelShowChange(parameterKey: string, show: boolean) {
  if (show) {
    return
  }

  const param = dynamicFilterParamViewModels.value.find(
    (entry) => entry.kind === 'color' && entry.parameterKey === parameterKey,
  )
  if (!param) {
    return
  }

  await commitDeferredUpdates()
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

.filter-properties-group__boolean-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--spacing-md);
}

.filter-properties-group__boolean-label {
  font-size: 14px;
  color: var(--lc-text-primary, #e5e7eb);
}

.filter-properties-group__boolean-input {
  width: 16px;
  height: 16px;
}

.filter-properties-group__color-field {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.filter-properties-group__color-label {
  font-size: 14px;
  color: var(--lc-text-primary, #e5e7eb);
}

.filter-properties-group__color-control {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--spacing-md);
}

.filter-properties-group__slider-value {
  min-width: 48px;
  text-align: right;
  color: var(--color-text-secondary);
  font-size: var(--font-size-sm);
}
</style>
