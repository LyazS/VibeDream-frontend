<template>
  <div
    class="template-category-tabs"
    :class="{ expanded: isExpanded }"
    @mouseenter="isExpanded = true"
    @mouseleave="isExpanded = false"
  >
    <n-scrollbar class="template-category-tabs__scroll">
      <button
        v-for="tab in tabs"
        :key="tab.key"
        class="template-category-tabs__item"
        :class="{ active: tab.key === activeKey }"
        :title="tab.label"
        @click="emit('select', tab.key)"
      >
        <div class="template-category-tabs__icon">
          <component :is="tab.icon" size="18px" />
        </div>
        <div class="template-category-tabs__label">{{ tab.label }}</div>
      </button>
    </n-scrollbar>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import { NScrollbar } from 'naive-ui'

interface CategoryTabItem {
  key: string
  label: string
  icon: unknown
}

defineProps<{
  tabs: CategoryTabItem[]
  activeKey: string
}>()

const emit = defineEmits<{
  select: [key: string]
}>()

const isExpanded = ref(false)
</script>

<style scoped>
.template-category-tabs {
  position: absolute;
  left: 0;
  top: 0;
  height: 100%;
  width: 38px;
  background-color: var(--color-bg-tertiary);
  border-right: 1px solid var(--color-border-primary);
  display: flex;
  flex-direction: column;
  transition: width 0.3s ease;
  z-index: 100;
  overflow: hidden;
}

.template-category-tabs.expanded {
  width: 132px;
  box-shadow: 2px 0 8px rgba(0, 0, 0, 0.3);
}

.template-category-tabs__scroll {
  flex: 1;
  max-height: 100%;
}

.template-category-tabs__item {
  width: calc(100% - 6px);
  display: flex;
  flex-direction: row;
  align-items: center;
  padding: 6px 5px;
  margin: 1px 3px;
  border-radius: var(--border-radius-small);
  cursor: pointer;
  transition: all var(--transition-fast);
  min-height: 36px;
  border: none;
  background: transparent;
  color: var(--color-text-secondary);
  text-align: left;
  appearance: none;
  -webkit-appearance: none;
}

.template-category-tabs__item:hover {
  background-color: var(--color-bg-hover);
  color: var(--color-text-primary);
}

.template-category-tabs__item.active {
  background-color: var(--color-accent-primary);
  color: #fff;
}

.template-category-tabs__icon {
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}

.template-category-tabs__label {
  margin-left: 6px;
  white-space: nowrap;
  opacity: 0;
  transition: opacity 0.2s ease;
  font-size: 12px;
  font-weight: 500;
}

.template-category-tabs.expanded .template-category-tabs__label {
  opacity: 1;
}
</style>
