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
import TimecodeInput from '@/components/base/TimecodeInput.vue'
import { useAppI18n } from '@/core/composables/useI18n'
import { effectTemplateRegistry } from '@/core/effect-template/EffectTemplateRegistry'
import { useUnifiedStore } from '@/core/unifiedStore'
import type { UnifiedTimelineItemData } from '@/core/timelineitem/type'
import { normalizeClipTransitionOutConfig } from '@/core/timelineitem/transition'

interface Props {
  selectedTimelineItem: UnifiedTimelineItemData<'video'> | UnifiedTimelineItemData<'image'> | null
}

const props = defineProps<Props>()
const { t } = useAppI18n()
const unifiedStore = useUnifiedStore()

function throwClipPropertyPhase0Todo(action: string): never {
  throw new Error(
    `[ClipProperty Phase 0 TODO] 属性区入口 "${action}" 仍在 TransitionPropertiesGroup 内部实现提交分流，` +
      '需先收敛到统一的属性提交入口后再恢复。',
  )
}

const transitionConfig = computed(() =>
  normalizeClipTransitionOutConfig(props.selectedTimelineItem?.transitionOut),
)

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
  throwClipPropertyPhase0Todo('transition.update')
  if (!props.selectedTimelineItem) return

  unifiedStore.pause()
  await unifiedStore.updateTransitionOutWithHistory(props.selectedTimelineItem.id, {
    ...transitionConfig.value,
    ...nextPatch,
  })
}

function handleDurationChange(nextDurationFrames: number) {
  void updateTransition({ durationFrames: nextDurationFrames })
}

function handleTimecodeError(message: string) {
  unifiedStore.messageError(message)
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
</style>
