<template>
  <div class="properties-panel">
    <!-- 媒体多选状态 -->
    <n-scrollbar v-if="mediaMultiSelectInfo" class="properties-scroll-area">
      <div class="media-multi-select-state">
        <component :is="IconComponents.CHECKBOX_MULTIPLE" size="32px" />
        <p>{{ t('properties.multiSelect.title', { count: mediaMultiSelectInfo.count }) }}</p>
        <p class="hint">{{ t('properties.multiSelect.hint') }}</p>

        <!-- 选中项目列表 -->
        <div class="selected-items-list">
          <div v-for="item in mediaMultiSelectInfo.items" :key="item?.id" class="selected-item">
            <span class="item-name">
              {{ item?.name || t('properties.multiSelect.unknownMedia') }}
            </span>
            <span class="item-type">{{
              t('properties.mediaTypes.' + (item?.mediaType || 'unknown'))
            }}</span>
          </div>
        </div>
      </div>
    </n-scrollbar>

    <!-- 媒体单选状态 -->
    <n-scrollbar v-else-if="selectedMediaItem" class="properties-scroll-area">
      <div class="media-properties-content">
        <MediaItemProperties :media-item="selectedMediaItem" />
      </div>
    </n-scrollbar>

    <!-- 时间轴多选状态 -->
    <n-scrollbar v-else-if="multiSelectInfo" class="properties-scroll-area">
      <div class="multi-select-state">
        <component :is="IconComponents.CHECKBOX_MULTIPLE" size="32px" />
        <p>{{ t('properties.multiSelect.title', { count: multiSelectInfo.count }) }}</p>
        <p class="hint">{{ t('properties.multiSelect.hint') }}</p>

        <!-- 选中项目列表 -->
        <div class="selected-items-list">
          <div v-for="item in multiSelectInfo.items" :key="item.id" class="selected-item">
            <span class="item-name">{{ item.label }}</span>
            <span class="item-type">{{ item.typeLabel }}</span>
          </div>
        </div>
      </div>
    </n-scrollbar>

    <n-scrollbar v-else-if="selectedTransitionOverlay" class="properties-scroll-area">
      <div class="properties-content">
        <TransitionSelectionPlaceholderGroup :overlay="selectedTransitionOverlay" />
      </div>
    </n-scrollbar>

    <!-- 时间轴单选状态 -->
    <template v-else-if="selectedTimelineItem">
      <!-- 只在ready状态时显示完整属性面板 -->
      <template v-if="selectedTimelineItem.timelineStatus === 'ready'">
        <div class="property-tabs" role="tablist" aria-label="Property tabs">
          <button
            v-for="tab in propertyTabs"
            :key="tab.key"
            type="button"
            class="property-tab"
            :class="{ active: activePropertyTab === tab.key }"
            :aria-selected="activePropertyTab === tab.key"
            :tabindex="activePropertyTab === tab.key ? 0 : -1"
            @click="activePropertyTab = tab.key"
          >
            {{ t(tab.labelKey) }}
          </button>
        </div>

        <n-scrollbar class="properties-scroll-area">
          <div class="properties-content properties-content--tabbed">
            <!-- 基础属性 -->
            <UnifiedClipProperties
              v-if="activePropertyTab === 'basic'"
              :selected-timeline-item="selectedTimelineItem"
              :current-frame="currentFrame"
            />

            <MaskPropertiesGroup
              v-else-if="activePropertyTab === 'mask' && selectedTimelineItem && hasVisualProperties(selectedTimelineItem)"
              :selected-timeline-item="selectedTimelineItem"
              :current-frame="currentFrame"
            />

            <TransitionPropertiesGroup
              v-else-if="activePropertyTab === 'transition' && selectedTimelineItem && supportsClipTransitionOut(selectedTimelineItem)"
              :selected-timeline-item="selectedTimelineItem"
            />

            <!-- 预留标签占位 -->
            <div v-else class="tab-placeholder-state">
              <component :is="IconComponents.CHECKBOX_BLANK" size="32px" />
              <p>{{ t('properties.tabs.placeholderTitle', { tab: t(activeTabLabelKey) }) }}</p>
              <p class="hint">
                {{ t('properties.tabs.placeholderDescription', { tab: t(activeTabLabelKey) }) }}
              </p>
            </div>
          </div>
        </n-scrollbar>
      </template>

      <!-- 非ready状态时显示加载状态或简化属性 -->
      <n-scrollbar v-else class="properties-scroll-area">
        <div class="loading-properties">
          <div class="loading-icon">
            <component :is="IconComponents.LOADING" size="20px" />
          </div>
          <p class="loading-text">{{ t('properties.singleSelect.loading') }}</p>
          <p class="loading-status">
            {{
              t('properties.singleSelect.loadingStatus', {
                status: getStatusText(selectedTimelineItem),
              })
            }}
          </p>
        </div>
      </n-scrollbar>
    </template>

    <!-- 无选择状态 -->
    <n-scrollbar v-else class="properties-scroll-area">
      <div class="empty-state">
        <component :is="IconComponents.CHECKBOX_BLANK" size="32px" />
        <p>{{ t('properties.singleSelect.emptyHint') }}</p>
        <p class="hint">{{ t('properties.singleSelect.emptyHintDetail') }}</p>
      </div>
    </n-scrollbar>
  </div>
</template>

<script setup lang="ts">
import { computed, watch } from 'vue'
import { useUnifiedStore } from '@/core/unifiedStore'
import { useAppI18n } from '@/core/composables/useI18n'
import { NScrollbar } from 'naive-ui'
import type { UnifiedTimelineItemData } from '@/core/timelineitem/type'
import { getStatusText } from '@/core/timelineitem/queries'
import { hasVisualProperties } from '@/core/timelineitem/queries'
import { supportsClipTransitionOut } from '@/core/timelineitem/queries'
import { IconComponents } from '@/constants/iconComponents'
import type { PropertyTabKey } from '@/core/modules/UnifiedUIModule'

import UnifiedClipProperties from '@/components/properties/unified/UnifiedClipProperties.vue'
import MediaItemProperties from '@/components/properties/MediaItemProperties.vue'
import MaskPropertiesGroup from '@/components/properties/groups/MaskPropertiesGroup.vue'
import TransitionPropertiesGroup from '@/components/properties/groups/TransitionPropertiesGroup.vue'
import TransitionSelectionPlaceholderGroup from '@/components/properties/groups/TransitionSelectionPlaceholderGroup.vue'
import { parseTimelineSelectionId } from '@/core/types/timelineSelection'

const unifiedStore = useUnifiedStore()
const { t } = useAppI18n()

const basePropertyTabs = [
  { key: 'basic', labelKey: 'properties.tabs.basic' },
  { key: 'transition', labelKey: 'properties.tabs.transition' },
  { key: 'mask', labelKey: 'properties.tabs.mask' },
  { key: 'filter', labelKey: 'properties.tabs.filter' },
  { key: 'animation', labelKey: 'properties.tabs.animation' },
] as const

const activePropertyTab = computed<PropertyTabKey>({
  get: () => unifiedStore.activePropertyTab,
  set: (tab) => unifiedStore.setActivePropertyTab(tab),
})

const propertyTabs = computed(() => {
  if (!selectedTimelineItem.value) {
    return basePropertyTabs
  }

  return basePropertyTabs.filter((tab) => {
    if (tab.key === 'mask') {
      return hasVisualProperties(selectedTimelineItem.value!)
    }
    if (tab.key === 'transition') {
      return supportsClipTransitionOut(selectedTimelineItem.value!)
    }
    return true
  })
})

// 选中的时间轴项目
const selectedTimelineItem = computed(() => {
  if (unifiedStore.isTimelineSelectionMultiSelectMode) return null
  if (!unifiedStore.selectedClipTimelineItemId) return null
  return unifiedStore.getTimelineItem(unifiedStore.selectedClipTimelineItemId) || null
})

const selectedTransitionOverlay = computed(() => {
  if (unifiedStore.isTimelineSelectionMultiSelectMode) return null
  return unifiedStore.getSelectedTransitionOverlay()
})

// 选中的媒体项目
const selectedMediaItem = computed(() => {
  // 多选模式时返回null，显示占位内容
  if (unifiedStore.isMediaMultiSelectMode) return null

  // 单选模式时返回选中项
  const selectedId = unifiedStore.selectedMediaItemId
  if (!selectedId) return null

  return unifiedStore.getMediaItem(selectedId) || null
})

// 当前播放帧数
const currentFrame = computed(() => unifiedStore.currentFrame)

const activeTabLabelKey = computed(() => {
  return propertyTabs.value.find((tab) => tab.key === activePropertyTab.value)?.labelKey
    ?? 'properties.tabs.basic'
})

// 多选状态信息
const multiSelectInfo = computed(() => {
  if (!unifiedStore.isTimelineSelectionMultiSelectMode) return null

  const selectedIds = unifiedStore.selectedTimelineSelectionIds
  return {
    count: selectedIds.size,
    items: Array.from(selectedIds).map((selectionId) => {
      const parsed = parseTimelineSelectionId(selectionId)
      if (!parsed) {
        return {
          id: selectionId,
          label: t('properties.multiSelect.unknownMedia'),
          typeLabel: t('properties.mediaTypes.unknown'),
        }
      }

      if (parsed.kind === 'transition') {
        const overlay = unifiedStore.getTransitionOverlay(parsed.sourceId)
        return {
          id: selectionId,
          label: overlay
            ? `${t('properties.transition.title')}: ${overlay.preset}`
            : t('properties.transition.title'),
          typeLabel: t('properties.transition.title'),
        }
      }

      const item = unifiedStore.getTimelineItem(parsed.sourceId)
      return {
        id: selectionId,
        label: item ? getItemDisplayName(item) : t('properties.multiSelect.unknownMedia'),
        typeLabel: t('properties.mediaTypes.' + (item?.mediaType || 'unknown')),
      }
    }),
  }
})

// 媒体多选状态信息
const mediaMultiSelectInfo = computed(() => {
  if (!unifiedStore.isMediaMultiSelectMode) return null

  const selectedIds = unifiedStore.selectedMediaItemIds
  return {
    count: selectedIds.size,
    items: Array.from(selectedIds)
      .map((id) => unifiedStore.getMediaItem(id))
      .filter(Boolean),
  }
})

// 获取项目显示名称
const getItemDisplayName = (item: any) => {
  if (!item) return '未知素材'

  if (item.mediaType === 'text') {
    // 文本项目显示文本内容
    const text = item.config?.text || '空文本'
    return text.length > 15 ? text.substring(0, 15) + '...' : text
  } else {
    // 其他类型显示素材名称
    return unifiedStore.getMediaItem(item.mediaItemId)?.name || '未知素材'
  }
}

watch(propertyTabs, (tabs) => {
  if (!tabs.some((tab) => tab.key === activePropertyTab.value)) {
    unifiedStore.setActivePropertyTab('basic')
  }
}, { immediate: true })
</script>

<style scoped>
.properties-panel {
  width: 100%;
  height: 100%;
  background-color: var(--color-bg-secondary);
  border-radius: var(--border-radius-medium);
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.properties-scroll-area {
  flex: 1;
  min-height: 0;
}

/* 属性面板特定样式 - 通用属性样式已迁移到 styles/components/panels.css 和 styles/components/inputs.css */

.property-tabs {
  display: flex;
  gap: var(--spacing-xs);
  padding: var(--spacing-sm) var(--spacing-lg) 0;
  border-bottom: 1px solid var(--color-border-primary);
  background-color: var(--color-bg-secondary);
  flex-shrink: 0;
}

.property-tab {
  border: none;
  border-bottom: 2px solid transparent;
  background: transparent;
  color: var(--color-text-secondary);
  cursor: pointer;
  padding: var(--spacing-sm) var(--spacing-xs);
  margin-bottom: -1px;
  font-size: var(--font-size-sm);
  font-weight: var(--font-weight-medium);
  transition: color 0.2s ease, border-color 0.2s ease, background-color 0.2s ease;
}

.property-tab:hover {
  color: var(--color-text-primary);
}

.property-tab.active {
  color: var(--color-accent-primary);
  border-bottom-color: var(--color-accent-primary);
}

.properties-content {
  padding: var(--spacing-md) var(--spacing-lg);
}

.properties-content--tabbed {
  min-height: 100%;
}

/* 媒体属性内容 */
.media-properties-content {
  padding: 0;
}

/* 多选状态样式 */
.multi-select-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
  color: var(--color-text-secondary);
  padding: var(--spacing-lg);
  height: 100%;
  overflow: hidden;
}

.multi-select-state svg {
  color: var(--color-success);
  margin-bottom: var(--spacing-md);
}

.multi-select-state p {
  margin: var(--spacing-xs) 0;
  font-size: var(--font-size-base);
}

.multi-select-state .hint {
  font-size: var(--font-size-sm);
  color: var(--color-text-hint);
}

.selected-items-list {
  margin-top: var(--spacing-lg);
  width: 100%;
  flex: 1;
  overflow-y: auto;
  min-height: 0;
}

.selected-item {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: var(--spacing-xs) var(--spacing-sm);
  margin-bottom: var(--spacing-xs);
  background: var(--color-bg-quaternary);
  border-radius: var(--border-radius-small);
  font-size: var(--font-size-sm);
}

.selected-item .item-name {
  flex: 1;
  text-align: left;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  margin-right: var(--spacing-sm);
}

.selected-item .item-type {
  color: var(--color-text-hint);
  font-size: var(--font-size-xs);
  flex-shrink: 0;
}

/* 加载状态样式 */
.loading-properties {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: var(--spacing-lg);
  text-align: center;
  color: var(--color-text-secondary);
}

.loading-icon {
  margin-bottom: var(--spacing-md);
  animation: spin 1s linear infinite;
}

.loading-icon svg {
  color: var(--color-accent-secondary);
}

.loading-text {
  font-size: var(--font-size-base);
  margin-bottom: var(--spacing-sm);
}

.loading-status {
  font-size: var(--font-size-sm);
  color: var(--color-text-hint);
}

.empty-state,
.media-multi-select-state,
.tab-placeholder-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
  color: var(--color-text-secondary);
  padding: var(--spacing-lg);
  min-height: 100%;
  box-sizing: border-box;
}

.empty-state svg,
.media-multi-select-state svg,
.tab-placeholder-state svg {
  margin-bottom: var(--spacing-md);
}

.empty-state p,
.media-multi-select-state p,
.tab-placeholder-state p {
  margin: var(--spacing-xs) 0;
  font-size: var(--font-size-base);
}

.empty-state .hint,
.media-multi-select-state .hint,
.tab-placeholder-state .hint {
  font-size: var(--font-size-sm);
  color: var(--color-text-hint);
}

@keyframes spin {
  0% {
    transform: rotate(0deg);
  }
  100% {
    transform: rotate(360deg);
  }
}
</style>
