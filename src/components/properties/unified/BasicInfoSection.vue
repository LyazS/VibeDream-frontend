<template>
  <div class="property-section">
    <h4>{{ t('properties.basic.basicInfo') }}</h4>
    
    <!-- 素材名称 -->
    <div class="property-item">
      <label>{{ t('properties.basic.name') }}</label>
      <input :value="clipName" readonly class="property-input" />
    </div>
    
    <!-- 分辨率（仅 visual 类型） -->
    <div v-if="showResolution && currentResolution" class="property-item">
      <label>{{ t('properties.basic.resolution') }}</label>
      <div class="resolution-display">
        {{ currentResolution.width }} × {{ currentResolution.height }}
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { useAppI18n } from '@/core/composables/useI18n'
import { useUnifiedStore } from '@/core/unifiedStore'
import { hasVisualProperties } from '@/core/timelineitem/queries'
import type { UnifiedTimelineItemData } from '@/core/timelineitem/type'

interface Props {
  selectedTimelineItem: UnifiedTimelineItemData | null
  showResolution?: boolean
}

const props = defineProps<Props>()
const { t } = useAppI18n()
const unifiedStore = useUnifiedStore()

// 获取素材名称
const clipName = computed(() => {
  if (!props.selectedTimelineItem) return ''
  const mediaItem = unifiedStore.getMediaItem(props.selectedTimelineItem.mediaItemId)
  return mediaItem?.name || ''
})

// 获取分辨率（仅 visual 类型）
const currentResolution = computed(() => {
  if (!props.selectedTimelineItem || !props.showResolution) {
    return null
  }
  
  if (!hasVisualProperties(props.selectedTimelineItem)) {
    return null
  }
  
  const config = props.selectedTimelineItem.baseRenderConfig.visual
  return {
    width: Math.round(config.width),
    height: Math.round(config.height),
  }
})
</script>

<style scoped>
/* 复用全局样式 */
.resolution-display {
  background: var(--color-bg-quaternary);
  border: 1px solid var(--color-border-secondary);
  border-radius: var(--border-radius-medium);
  color: var(--color-text-primary);
  font-size: var(--font-size-base);
  padding: var(--spacing-sm) var(--spacing-md);
  text-align: center;
  font-family: monospace;
}
</style>
