<template>
  <div class="transition-properties-group">
    <div class="property-section">
      <h4>{{ t('properties.transition.title') }}</h4>

      <div class="property-item">
        <label>{{ t('properties.transitionSelection.effectAsset') }}</label>
        <div class="transition-template-name">{{ transitionTemplateName }}</div>
      </div>

      <div class="property-item">
        <label>{{ t('properties.transition.durationFrames') }}</label>
        <TimecodeInput
          :model-value="transitionConfig.durationFrames"
          :placeholder="t('properties.timecodes.timecodeFormat')"
          :input-style="{ maxWidth: '100%', textAlign: 'left' }"
          @update:model-value="handleDurationChange"
          @error="handleTimecodeError"
        />
      </div>

      <div
        v-if="dynamicTransitionParamViewModels.length > 0"
        class="transition-properties-group__dynamic-params"
      >
        <template
          v-for="param in dynamicTransitionParamViewModels"
          :key="param.parameterKey"
        >
          <div
            v-if="param.kind === 'float' || param.kind === 'int'"
            class="property-item"
          >
            <label>{{ param.label }}</label>
            <div class="transition-properties-group__slider-row">
              <SliderInput
                :model-value="param.value"
                :min="param.min"
                :max="param.max"
                :step="param.step"
                @input="(value) => setTransitionParamDeferred(param.parameterKey, getNextScalarParamValue(param.kind, value))"
                @change="void commitDeferredUpdates()"
              />
              <NumberInput
                :model-value="param.value"
                :min="param.min"
                :max="param.max"
                :step="param.step"
                :precision="param.precision"
                :show-controls="false"
                input-class="transition-properties-group__number-input"
                @change="(value) => void setTransitionParamDirect(param.parameterKey, getNextScalarParamValue(param.kind, value))"
              />
            </div>
          </div>

	          <div
	            v-else-if="param.kind === 'int-select'"
	            class="property-item"
	          >
	            <label>{{ param.label }}</label>
	            <SearchableSelect
	              :model-value="param.value"
	              :options="param.options"
	              :searchable="false"
	              value-key="value"
	              label-key="label"
	              :placeholder="param.label"
	              @update:model-value="(value) => void setTransitionParamDirect(param.parameterKey, Math.round(Number(value)))"
	            />
	          </div>

	          <div
	            v-else-if="param.kind === 'vec2' || param.kind === 'ivec2'"
	            class="property-item"
	          >
            <label>{{ param.label }}</label>
            <div class="transition-properties-group__vec2-row">
              <div class="transition-properties-group__vec2-input">
                <span class="transition-properties-group__axis-label">X</span>
                <NumberInput
                  :model-value="param.value.x"
                  :min="param.min"
                  :max="param.max"
                  :step="param.step"
                  :precision="param.precision"
                  :realtime="true"
                  @input="(value) => setTransitionParamVec2Deferred(param.parameterKey, getNextTransitionParamVec2Value(param.value, 'x', value, param.kind))"
                  @change="(value) => void setTransitionParamVec2Direct(param.parameterKey, getNextTransitionParamVec2Value(param.value, 'x', value, param.kind))"
                />
              </div>
              <div class="transition-properties-group__vec2-input">
                <span class="transition-properties-group__axis-label">Y</span>
                <NumberInput
                  :model-value="param.value.y"
                  :min="param.min"
                  :max="param.max"
                  :step="param.step"
                  :precision="param.precision"
                  :realtime="true"
                  @input="(value) => setTransitionParamVec2Deferred(param.parameterKey, getNextTransitionParamVec2Value(param.value, 'y', value, param.kind))"
                  @change="(value) => void setTransitionParamVec2Direct(param.parameterKey, getNextTransitionParamVec2Value(param.value, 'y', value, param.kind))"
                />
              </div>
            </div>
          </div>

          <div
            v-else-if="param.kind === 'vec3'"
            class="property-item"
          >
            <label>{{ param.label }}</label>
            <div class="transition-properties-group__vec2-row">
              <div
                v-for="axis in ['x', 'y', 'z'] as const"
                :key="axis"
                class="transition-properties-group__vec2-input"
              >
                <span class="transition-properties-group__axis-label">{{ axis.toUpperCase() }}</span>
                <NumberInput
                  :model-value="param.value[axis]"
                  :min="param.min"
                  :max="param.max"
                  :step="param.step"
                  :precision="param.precision"
                  :realtime="true"
                  @input="(value) => setTransitionParamVectorDeferred(param.parameterKey, getNextTransitionParamVec3Value(param.value, axis, value), ['x', 'y', 'z'])"
                  @change="(value) => void setTransitionParamVectorDirect(param.parameterKey, getNextTransitionParamVec3Value(param.value, axis, value), ['x', 'y', 'z'])"
                />
              </div>
            </div>
          </div>

          <div
            v-else-if="param.kind === 'vec4'"
            class="property-item"
          >
            <label>{{ param.label }}</label>
            <div class="transition-properties-group__vec2-row">
              <div
                v-for="axis in ['x', 'y', 'z', 'w'] as const"
                :key="axis"
                class="transition-properties-group__vec2-input"
              >
                <span class="transition-properties-group__axis-label">{{ axis.toUpperCase() }}</span>
                <NumberInput
                  :model-value="param.value[axis]"
                  :min="param.min"
                  :max="param.max"
                  :step="param.step"
                  :precision="param.precision"
                  :realtime="true"
                  @input="(value) => setTransitionParamVectorDeferred(param.parameterKey, getNextTransitionParamVec4Value(param.value, axis, value), ['x', 'y', 'z', 'w'])"
                  @change="(value) => void setTransitionParamVectorDirect(param.parameterKey, getNextTransitionParamVec4Value(param.value, axis, value), ['x', 'y', 'z', 'w'])"
                />
              </div>
            </div>
          </div>

          <div
            v-else-if="param.kind === 'color'"
            class="transition-properties-group__color-field"
          >
            <label class="transition-properties-group__color-label">
              {{ param.label }}
            </label>
            <NColorPicker
              :value="getTransitionParamColorCssValue(param.value)"
              :show-alpha="true"
              :modes="['hex']"
              @update:value="(value) => handleTransitionParamColorInput(param.parameterKey, value)"
              @update:show="(show) => void handleTransitionParamColorPanelShowChange(param.parameterKey, show)"
            />
          </div>

          <div
            v-else-if="param.kind === 'boolean'"
            class="transition-properties-group__boolean-row"
          >
            <label
              :for="`transition-param-${param.parameterKey}`"
              class="transition-properties-group__boolean-label"
            >
              {{ param.label }}
            </label>
            <input
              :id="`transition-param-${param.parameterKey}`"
              type="checkbox"
              :checked="param.value"
              class="transition-properties-group__boolean-input"
              @change="handleTransitionParamBooleanChange(param.parameterKey, $event)"
            />
          </div>
        </template>
      </div>

      <div class="transition-status">
        <div class="transition-status__label">{{ t('properties.transition.status') }}</div>
        <div class="transition-status__value">{{ statusText }}</div>
        <div v-if="boundRightItemName" class="transition-status__meta">
          {{ t('properties.transition.targetClip', { name: boundRightItemName }) }}
        </div>
        <div v-if="effectiveDurationText" class="transition-status__meta">
          {{ effectiveDurationText }}
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { NColorPicker } from 'naive-ui'
import NumberInput from '@/components/base/NumberInput.vue'
import SearchableSelect from '@/components/base/SearchableSelect.vue'
import SliderInput from '@/components/base/SliderInput.vue'
import TimecodeInput from '@/components/base/TimecodeInput.vue'
import {
  colorToCssRgbaString,
  normalizeFilterParamColor,
  type FilterParamColorValue,
} from '@/core/filter/color'
import { useDynamicEffectParamViewModels } from '@/core/composables/effectParams/useDynamicEffectParamViewModels'
import type {
  EffectParamVec2Value,
  EffectParamVec3Value,
  EffectParamVec4Value,
} from '@/core/composables/effectParams/types'
import { useAppI18n, useUnifiedTransitionControls } from '@/core/composables'
import { effectTemplateRegistry } from '@/core/effect-template/EffectTemplateRegistry'
import { useUnifiedStore } from '@/core/unifiedStore'
import type { UnifiedTimelineItemData } from '@/core/timelineitem/model/timelineItem'

interface Props {
  selectedTimelineItem: UnifiedTimelineItemData<'video'> | UnifiedTimelineItemData<'image'> | null
}

const props = defineProps<Props>()
const { t, locale } = useAppI18n()
const unifiedStore = useUnifiedStore()
const selectedTimelineItem = computed(() => props.selectedTimelineItem)

const {
  transitionConfig,
  transitionParameterSchema,
  setTransitionParamDeferred,
  setTransitionParamDirect,
  setTransitionParamVec2Deferred,
  setTransitionParamVec2Direct,
  setTransitionParamVectorDeferred,
  setTransitionParamVectorDirect,
  setTransitionParamBooleanDirect,
  setTransitionParamColorDeferred,
  commitDeferredUpdates,
} = useUnifiedTransitionControls({
  selectedTimelineItem,
})

const dynamicTransitionParamViewModels = useDynamicEffectParamViewModels({
  params: computed(() => transitionConfig.value.params),
  parameterSchema: transitionParameterSchema,
  locale,
})

const transitionRuntime = computed(() => props.selectedTimelineItem?.runtime.transition)

const transitionTemplateName = computed(() => {
  const effectPackageId = transitionConfig.value.effectPackageId
  if (!effectPackageId) return '-'
  return effectTemplateRegistry.getPackageState(effectPackageId)?.meta?.name.zh
    || effectTemplateRegistry.getPackageState(effectPackageId)?.meta?.name.en
    || transitionConfig.value.packagePayload?.manifestSnapshot.name.zh
    || transitionConfig.value.packagePayload?.manifestSnapshot.name.en
    || effectPackageId
})

const boundRightItemName = computed(() => {
  const rightItemId = transitionRuntime.value?.rightItemId
  if (!rightItemId) return ''

  const rightItem = unifiedStore.getTimelineItem(rightItemId)
  if (!rightItem || rightItem.mediaItemId === null) return ''

  return unifiedStore.getMediaItem(rightItem.mediaItemId)?.name || ''
})

const effectiveDurationText = computed(() => {
  const runtime = transitionRuntime.value
  if (!runtime || runtime.bindingState === 'unbound' || runtime.effectiveDurationFrames <= 0) {
    return ''
  }

  return t('properties.transition.effectiveDuration', {
    frames: runtime.effectiveDurationFrames,
  })
})

const statusText = computed(() => {
  const bindingState = transitionRuntime.value?.bindingState || 'unbound'

  switch (bindingState) {
    case 'bound':
      return t('properties.transition.statuses.bound')
    case 'waiting-edge':
      return t('properties.transition.statuses.waitingEdge')
    case 'invalid-target':
      return t('properties.transition.statuses.invalidTarget')
    case 'invalid-overlap':
      return t('properties.transition.statuses.invalidOverlap')
    case 'unbound':
    default:
      return t('properties.transition.statuses.unbound')
  }
})

async function updateTransition(nextPatch: {
  durationFrames?: number
}) {
  if (!props.selectedTimelineItem) return

  unifiedStore.pause()
  await unifiedStore.updateTransitionConfigWithHistory(props.selectedTimelineItem.id, {
    ...transitionConfig.value,
    ...nextPatch,
  })
}

function handleDurationChange(nextDurationFrames: number) {
  void updateTransition({ durationFrames: nextDurationFrames })
}

function getNextTransitionParamVec2Value(
  currentValue: EffectParamVec2Value,
  axis: 'x' | 'y',
  value: number,
  kind: 'vec2' | 'ivec2',
): EffectParamVec2Value {
  return {
    ...currentValue,
    [axis]: kind === 'ivec2' ? Math.round(value) : value,
  }
}

function getNextTransitionParamVec3Value(
  currentValue: EffectParamVec3Value,
  axis: 'x' | 'y' | 'z',
  value: number,
): EffectParamVec3Value {
  return {
    ...currentValue,
    [axis]: value,
  }
}

function getNextTransitionParamVec4Value(
  currentValue: EffectParamVec4Value,
  axis: 'x' | 'y' | 'z' | 'w',
  value: number,
): EffectParamVec4Value {
  return {
    ...currentValue,
    [axis]: value,
  }
}

function getNextScalarParamValue(kind: 'float' | 'int', value: number): number {
  return kind === 'int' ? Math.round(value) : value
}

function handleTransitionParamBooleanChange(parameterKey: string, event: Event) {
  const target = event.target
  if (!(target instanceof HTMLInputElement)) {
    return
  }

  void setTransitionParamBooleanDirect(parameterKey, target.checked)
}

function getTransitionParamColorCssValue(value: FilterParamColorValue): string {
  return colorToCssRgbaString(value)
}

function handleTransitionParamColorInput(parameterKey: string, value: string) {
  setTransitionParamColorDeferred(parameterKey, normalizeFilterParamColor(value))
}

async function handleTransitionParamColorPanelShowChange(parameterKey: string, show: boolean) {
  if (show) {
    return
  }

  const param = dynamicTransitionParamViewModels.value.find(
    (entry) => entry.kind === 'color' && entry.parameterKey === parameterKey,
  )
  if (!param) {
    return
  }

  await commitDeferredUpdates()
}

function handleTimecodeError(message: string) {
  unifiedStore.messageError(message)
}
</script>

<style scoped>
.transition-properties-group {
  width: 100%;
}

.transition-properties-group__dynamic-params {
  display: flex;
  flex-direction: column;
  gap: var(--spacing-md);
  margin-top: var(--spacing-md);
}

.transition-properties-group__slider-row {
  display: flex;
  align-items: center;
  gap: var(--spacing-xs);
}

.transition-properties-group__vec2-row {
  display: flex;
  gap: var(--spacing-xs);
}

.transition-properties-group__vec2-input {
  display: flex;
  align-items: center;
  gap: var(--spacing-xs);
  flex: 1;
  min-width: 0;
}

.transition-properties-group__axis-label {
  color: var(--color-text-secondary);
  font-size: var(--font-size-sm);
  min-width: 12px;
}

.transition-properties-group__boolean-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--spacing-md);
}

.transition-properties-group__boolean-label {
  font-size: 14px;
  color: var(--lc-text-primary, #e5e7eb);
}

.transition-properties-group__boolean-input {
  width: 16px;
  height: 16px;
}

.transition-properties-group__color-field {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.transition-properties-group__color-label {
  font-size: 14px;
  color: var(--lc-text-primary, #e5e7eb);
}

.transition-status {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 10px 12px;
  border-radius: var(--border-radius-medium);
  background: var(--color-bg-tertiary);
  border: 1px solid var(--color-border-secondary);
}

.transition-status__label {
  font-size: var(--font-size-sm);
  color: var(--color-text-secondary);
}

.transition-status__value {
  font-size: var(--font-size-base);
  color: var(--color-text-primary);
}

.transition-status__meta {
  font-size: var(--font-size-sm);
  color: var(--color-text-secondary);
}

.transition-template-name {
  min-height: 32px;
  display: flex;
  align-items: center;
  padding: 0 10px;
  border-radius: var(--border-radius-medium);
  background: var(--color-bg-tertiary);
  border: 1px solid var(--color-border-secondary);
  color: var(--color-text-primary);
  font-size: var(--font-size-sm);
}

:deep(.transition-properties-group__number-input) {
  width: 120px;
}
</style>
