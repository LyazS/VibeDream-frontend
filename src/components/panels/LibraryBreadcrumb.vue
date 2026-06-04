<template>
  <div class="breadcrumb-container" v-if="breadcrumb.length > 0">
    <n-scrollbar x-scrollable class="breadcrumb-scrollbar">
      <div class="breadcrumb">
        <span
          v-for="(dir, index) in breadcrumb"
          :key="dir.id"
          class="breadcrumb-item"
          @click="navigateToDir(dir.id)"
        >
          <component :is="IconComponents.HOME" v-if="index === 0" size="16px" />
          <span v-if="index > 0">{{ dir.name }}</span>
          <span v-if="index < breadcrumb.length - 1" class="breadcrumb-separator"> / </span>
        </span>
      </div>
    </n-scrollbar>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { NScrollbar } from 'naive-ui'
import { useUnifiedStore } from '@/core/unifiedStore'
import { IconComponents } from '@/constants/iconComponents'

const unifiedStore = useUnifiedStore()

// 当前目录
const currentDir = computed(() => unifiedStore.currentDir)

// 面包屑路径
const breadcrumb = computed(() => {
  if (!currentDir.value) return []
  return unifiedStore.getBreadcrumb(currentDir.value.id)
})

// 导航到指定目录
function navigateToDir(dirId: string): void {
  unifiedStore.navigateToDir(dirId)
}
</script>

<style scoped>
/* 面包屑导航容器样式 */
.breadcrumb-container {
  padding: 4px 12px 2px;
  background-color: transparent;
}

/* 面包屑滚动容器 */
.breadcrumb-scrollbar {
  width: 100%;
}

/* 面包屑导航样式 */
.breadcrumb {
  display: flex;
  align-items: center;
  flex-wrap: nowrap;
  white-space: nowrap;
  padding: 0;
}

.breadcrumb-item {
  display: flex;
  align-items: center;
  gap: 0;
  cursor: pointer;
  padding: 0;
  transition: color var(--transition-fast);
  font-size: 11px;
  color: var(--color-text-secondary);
}

.breadcrumb-item:hover {
  color: var(--color-accent-primary);
}

.breadcrumb-separator {
  color: var(--color-text-muted);
  margin: 0 6px;
}
</style>
