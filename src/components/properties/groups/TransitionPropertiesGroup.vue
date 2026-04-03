<template>
  <div class="transition-properties-group">
    <div class="property-section">
      <h4>{{ t('properties.transition.title') }}</h4>

      <div class="property-item">
        <label>{{ t('properties.transition.enabled') }}</label>
        <input
          :checked="transitionConfig.enabled"
          type="checkbox"
          class="checkbox-input"
          @change="handleToggleEnabled"
        />
      </div>

      <div class="property-item">
        <label>{{ t('properties.transition.preset') }}</label>
        <SearchableSelect
          :model-value="transitionConfig.preset"
          :options="presetOptions"
          :searchable="false"
          :placeholder="t('properties.transition.preset')"
          @update:model-value="handlePresetChange"
        />
      </div>

      <div class="property-item">
        <label>{{ t('properties.transition.durationFrames') }}</label>
        <NumberInput
          :model-value="transitionConfig.durationFrames"
          :min="2"
          :max="300"
          :step="1"
          :precision="0"
          :show-controls="true"
          unit="f"
          @change="handleDurationChange"
        />
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
import SearchableSelect from '@/components/base/SearchableSelect.vue'
import NumberInput from '@/components/base/NumberInput.vue'
import { useAppI18n } from '@/core/composables/useI18n'
import { useUnifiedStore } from '@/core/unifiedStore'
import type { UnifiedTimelineItemData } from '@/core/timelineitem/type'
import type { ClipTransitionOutPreset } from '@/core/timelineitem/transition'
import { normalizeClipTransitionOutConfig } from '@/core/timelineitem/transition'

interface Props {
  selectedTimelineItem: UnifiedTimelineItemData<'video'> | UnifiedTimelineItemData<'image'> | null
}

const props = defineProps<Props>()
const { t } = useAppI18n()
const unifiedStore = useUnifiedStore()

const presetOptions = computed(() => [
  {
    label: t('properties.transition.presets.crossfade'),
    value: 'crossfade',
  },
])

const transitionConfig = computed(() =>
  normalizeClipTransitionOutConfig(props.selectedTimelineItem?.transitionOut),
)

const transitionRuntime = computed(() => props.selectedTimelineItem?.runtime.transition)

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
  enabled?: boolean
  preset?: ClipTransitionOutPreset
  durationFrames?: number
}) {
  if (!props.selectedTimelineItem) return

  unifiedStore.pause()
  await unifiedStore.updateTransitionOutWithHistory(props.selectedTimelineItem.id, {
    ...transitionConfig.value,
    ...nextPatch,
  })
}

function handleToggleEnabled(event: Event) {
  const input = event.target as HTMLInputElement
  void updateTransition({ enabled: input.checked })
}

function handlePresetChange(nextPreset: ClipTransitionOutPreset) {
  void updateTransition({ preset: nextPreset })
}

function handleDurationChange(nextDurationFrames: number) {
  void updateTransition({ durationFrames: nextDurationFrames })
}
</script>

<style scoped>
.transition-properties-group {
  width: 100%;
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
</style>
