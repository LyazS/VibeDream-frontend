<template>
  <div
    class="library-tabs"
    :class="{ expanded: isExpanded }"
    @mouseenter="isExpanded = true"
    @mouseleave="isExpanded = false"
    @dragleave="handleContainerDragLeave"
  >
    <!-- 可滚动的标签列表区域 -->
    <n-scrollbar class="tabs-scroll-area">
      <div
        v-for="tab in openTabs"
        :key="tab.id"
        class="tab-item"
        :class="{
          active: tab.id === activeTabId,
          'can-drop-tab': tabDragState[tab.id]?.canDrop,
          'cannot-drop-tab': tabDragState[tab.id]?.isDragOver && !tabDragState[tab.id]?.canDrop,
        }"
        :title="getDirectory(tab.dirId)?.name || ''"
        @click="switchTab(tab.id)"
        @dragenter="handleTabDragEnter($event, tab.id)"
        @dragover="handleTabDragOver($event, tab.id)"
        @dragleave="handleTabDragLeave($event, tab.id)"
        @drop="handleTabDrop($event, tab.id)"
      >
        <div class="tab-icon">
          <component :is="IconComponents.FOLDER" size="18px" />
        </div>
        <div class="tab-label">{{ getDirectory(tab.dirId)?.name || '' }}</div>
        <button
          v-if="openTabs.length > 1"
          class="tab-close"
          @click.stop="closeTab(tab.id)"
          :title="t('media.closeTab')"
        >
          <component :is="IconComponents.CLOSE" size="14px" />
        </button>
      </div>
    </n-scrollbar>

    <!-- 固定在底部的新建按钮 -->
    <div class="tabs-footer">
      <button class="add-tab-btn" @click="openNewTab" :title="t('media.newTab')">
        <component :is="IconComponents.ADD" size="14px" />
        <span class="add-tab-label">{{ t('media.newTab') }}</span>
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import { NScrollbar } from 'naive-ui'
import { useAppI18n } from '@/core/composables/useI18n'
import { useUnifiedStore } from '@/core/unifiedStore'
import type { VirtualDirectory } from '@/core/directory/types'
import { DropTargetType, type DropTargetInfo } from '@/core/types/drag'
import { IconComponents } from '@/constants/iconComponents'

const unifiedStore = useUnifiedStore()
const { t } = useAppI18n()

// 展开/折叠状态
const isExpanded = ref(false)

// 从 store 获取状态
const openTabs = computed(() => unifiedStore.openTabs)
const activeTabId = computed(() => unifiedStore.activeTabId)
const currentDir = computed(() => unifiedStore.currentDir)

// 标签页拖拽状态
const tabDragState = ref<Record<string, { isDragOver: boolean; canDrop: boolean }>>({})

// 获取目录
function getDirectory(id: string): VirtualDirectory | undefined {
  return unifiedStore.getDirectory(id)
}

// 切换标签页
function switchTab(tabId: string): void {
  unifiedStore.switchTab(tabId)
}

// 打开新标签页
function openNewTab(): void {
  // 查找根目录（parentId 为 null 的目录）
  const rootDir = unifiedStore.getAllDirectories().find((dir) => dir.parentId === null)

  if (rootDir) {
    // 如果根目录存在，打开根目录的新标签页
    unifiedStore.openTab(rootDir.id, true)
  } else {
    // 如果根目录不存在，初始化根目录
    unifiedStore.initializeRootDirectory()
  }
}

// 关闭标签页
function closeTab(tabId: string): void {
  unifiedStore.closeTab(tabId)
}

// ========== 拖拽事件处理 ==========

/**
 * 拖拽进入标签页
 */
function handleTabDragEnter(event: DragEvent, tabId: string): void {
  event.preventDefault()
  event.stopPropagation()

  // 拖拽时自动展开
  isExpanded.value = true

  if (!tabDragState.value[tabId]) {
    tabDragState.value[tabId] = { isDragOver: false, canDrop: false }
  }

  tabDragState.value[tabId].isDragOver = true
}

/**
 * 拖拽悬停在标签页上
 */
function handleTabDragOver(event: DragEvent, tabId: string): void {
  event.preventDefault()
  event.stopPropagation()

  // 拖拽时保持展开
  isExpanded.value = true

  const targetInfo: DropTargetInfo = {
    targetType: DropTargetType.TAB,
    targetId: tabId,
  }

  const allowed = unifiedStore.handleDragOver(event, targetInfo)

  if (!tabDragState.value[tabId]) {
    tabDragState.value[tabId] = { isDragOver: true, canDrop: false }
  }
  tabDragState.value[tabId].canDrop = allowed
}

/**
 * 拖拽离开标签页项
 */
function handleTabDragLeave(event: DragEvent, tabId: string): void {
  event.stopPropagation()

  const currentTarget = event.currentTarget as Element
  const relatedTarget = event.relatedTarget as Node

  if (currentTarget && !currentTarget.contains(relatedTarget)) {
    if (tabDragState.value[tabId]) {
      tabDragState.value[tabId].isDragOver = false
      tabDragState.value[tabId].canDrop = false
    }
  }
}

/**
 * 拖拽离开整个标签页容器
 */
function handleContainerDragLeave(event: DragEvent): void {
  const currentTarget = event.currentTarget as Element
  const relatedTarget = event.relatedTarget as Node

  // 检查是否真的离开了容器（不是进入子元素）
  if (currentTarget && !currentTarget.contains(relatedTarget)) {
    isExpanded.value = false
  }
}

/**
 * 拖拽放置到标签页
 */
async function handleTabDrop(event: DragEvent, tabId: string): Promise<void> {
  event.preventDefault()
  event.stopPropagation()

  // 重置视觉状态
  if (tabDragState.value[tabId]) {
    tabDragState.value[tabId].isDragOver = false
    tabDragState.value[tabId].canDrop = false
  }

  const targetInfo: DropTargetInfo = {
    targetType: DropTargetType.TAB,
    targetId: tabId,
  }

  const result = await unifiedStore.handleDrop(event, targetInfo)

  if (result.success) {
    // 可选：切换到目标标签页
    switchTab(tabId)
  }

  // 拖拽结束后折叠
  isExpanded.value = false
}
</script>

<style scoped>
/* 左侧标签页样式 */
.library-tabs {
  position: absolute;
  left: 0;
  top: 0;
  height: 100%;
  width: 38px; /* 折叠状态宽度 */
  background-color: var(--color-bg-tertiary);
  border-right: 1px solid var(--color-border-primary);
  display: flex;
  flex-direction: column;
  transition: width 0.3s ease;
  z-index: 100;
  overflow: hidden; /* 容器本身不滚动 */
}

/* 可滚动的标签列表区域 */
.tabs-scroll-area {
  flex: 1;
  max-height: 100%;
}

/* 固定在底部的区域 */
.tabs-footer {
  flex-shrink: 0;
  padding: 4px 0;
  border-top: 1px solid var(--color-border-primary);
}

/* 展开状态 */
.library-tabs.expanded {
  width: 132px; /* 展开宽度 */
  box-shadow: 2px 0 8px rgba(0, 0, 0, 0.3);
}

.tab-item {
  display: flex;
  flex-direction: row;
  align-items: center;
  padding: 6px 5px;
  margin: 1px 3px;
  border-radius: var(--border-radius-small);
  cursor: pointer;
  transition: all var(--transition-fast);
  position: relative;
  min-height: 36px;
}

.tab-item:hover {
  background-color: var(--color-bg-hover);
}

.tab-item.active {
  background-color: var(--color-accent-primary);
  color: white;
}

.tab-icon {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
}

.tab-label {
  font-size: 12px;
  line-height: 1.2;
  margin-left: 6px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  opacity: 0;
  transition: opacity 0.3s ease;
}

.library-tabs.expanded .tab-label {
  opacity: 1;
}

.tab-close {
  margin-left: auto;
  background: transparent;
  border: none;
  border-radius: 50%;
  color: currentColor;
  width: 18px;
  height: 18px;
  cursor: pointer;
  display: none;
  align-items: center;
  justify-content: center;
  opacity: 0.6;
  transition: all var(--transition-fast);
  flex-shrink: 0;
}

.library-tabs.expanded .tab-item:hover .tab-close {
  display: flex;
}

.tab-close:hover {
  opacity: 1;
  background: rgba(255, 255, 255, 0.1);
}

.add-tab-btn {
  display: flex;
  flex-direction: row;
  align-items: center;
  justify-content: center;
  min-height: 30px;
  margin: 4px 6px;
  padding: 5px;
  border: 1px dashed var(--color-border-secondary);
  border-radius: var(--border-radius-small);
  background: transparent;
  color: var(--color-text-secondary);
  cursor: pointer;
  transition: all var(--transition-fast);
}

.add-tab-label {
  font-size: 12px;
  margin-left: 0;
  width: 0;
  opacity: 0;
  overflow: hidden;
  transition: all 0.3s ease;
  white-space: nowrap;
}

.library-tabs.expanded .add-tab-label {
  margin-left: 6px;
  width: auto;
  opacity: 1;
}

/* 拖拽反馈样式 */
.tab-item {
  border: 2px solid transparent;
}

.tab-item.can-drop-tab {
  border-color: #28a745;
  background-color: rgba(40, 167, 69, 0.15);
  box-shadow: 0 0 0 2px rgba(40, 167, 69, 0.3);
  transform: scale(1.05);
}

.tab-item.cannot-drop-tab {
  border-color: #dc3545;
  background-color: rgba(220, 53, 69, 0.15);
  box-shadow: 0 0 0 2px rgba(220, 53, 69, 0.3);
  cursor: not-allowed;
}

.add-tab-btn:hover {
  border-color: var(--color-accent-primary);
  color: var(--color-accent-primary);
  background: rgba(59, 130, 246, 0.1);
}

/* 拖拽反馈样式 */
.tab-item {
  border: 2px solid transparent;
}

.tab-item.can-drop-tab {
  border-color: #28a745;
  background-color: rgba(40, 167, 69, 0.15);
  box-shadow: 0 0 0 2px rgba(40, 167, 69, 0.3);
  transform: scale(1.05);
}

.tab-item.cannot-drop-tab {
  border-color: #dc3545;
  background-color: rgba(220, 53, 69, 0.15);
  box-shadow: 0 0 0 2px rgba(220, 53, 69, 0.3);
  cursor: not-allowed;
}
</style>
