<template>
  <div class="card-grid-view">
    <!-- 搜索栏 -->
    <div class="search-bar">
      <div class="search-input-wrapper">
        <component
          :is="IconComponents.SEARCH"
          size="16px"
          class="search-icon"
        />
        <input
          v-model="searchKeyword"
          type="text"
          class="search-input"
          :placeholder="t('aiPanel.searchPlaceholder')"
        />
        <button
          v-if="searchKeyword"
          class="clear-button"
          @click="clearSearch"
        >
          <component :is="IconComponents.CLOSE" size="14px" />
        </button>
      </div>
    </div>

    <!-- 卡片网格 -->
    <div class="cards-grid">
      <div
        v-for="config in filteredConfigOptions"
        :key="config.value"
        class="config-card"
        @click="handleCardClick(config.value)"
      >
        <div class="card-header">
          <div class="header-left">
            <component
              :is="getIconForContentType(config.value)"
              size="24px"
              class="card-icon"
            />
            <h3 class="card-title">{{ config.label }}</h3>
          </div>
          <!-- 根据 provider 类型显示对应的服务商 logo -->
          <img
            :src="getProviderLogo(config.provider).src"
            :alt="getProviderLogo(config.provider).alt"
            class="provider-logo"
          />
        </div>
        <p
          class="card-description"
          :class="{ 'show-ellipsis': shouldShowEllipsis(config.description) }"
        >
          {{ config.description }}
        </p>
      </div>
      
      <!-- 无搜索结果提示 -->
      <div v-if="filteredConfigOptions.length === 0" class="no-results">
        <component :is="IconComponents.SEARCH" size="48px" class="no-results-icon" />
        <p class="no-results-text">{{ t('aiPanel.noResults') }}</p>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue'
import { collection, type ConfigKey } from '@/components/ai-generation/configs'
import { IconComponents } from '@/constants/iconComponents'
import { useAppI18n } from '@/core/composables/useI18n'
import type { Component } from 'vue'
import { useUnifiedStore } from '@/core/unifiedStore'

/**
 * 服务商类型枚举
 */
enum ProviderType {
  LIGHTCUT = 'lightcut',      // LightCut 自己的服务
  BIZYAIR = 'bizyair',         // BizyAir 服务
}

interface ConfigOption {
  label: string
  value: ConfigKey
  description: string
  provider: ProviderType  // 服务商类型
}

interface Props {
  locale: 'zh' | 'en'
}

interface Emits {
  (e: 'cardClick', configKey: ConfigKey): void
}

const props = defineProps<Props>()
const emit = defineEmits<Emits>()

// 使用全局 i18n 获取翻译函数
const { t } = useAppI18n()

// 引入 unifiedStore 获取 BizyAir API Key 状态
const unifiedStore = useUnifiedStore()

/**
 * 服务商 Logo 配置映射
 */
const providerLogoMap: Record<ProviderType, { src: string; alt: string }> = {
  [ProviderType.LIGHTCUT]: {
    src: '/icon/favicon.svg',
    alt: 'LightCut',
  },
  [ProviderType.BIZYAIR]: {
    src: '/logo-3rd/bizyair.webp',
    alt: 'BizyAir',
  },
}

/**
 * 获取服务商 Logo 信息
 */
const getProviderLogo = (provider: ProviderType) => {
  return providerLogoMap[provider]
}

// 搜索关键词
const searchKeyword = ref('')

// 从 collection 生成选项列表，支持多语言
const configOptions = computed<ConfigOption[]>(() => {
  return Object.entries(collection).map(([key, config]) => {
    // 根据配置和用户状态判断服务商类型
    let provider = ProviderType.LIGHTCUT  // 默认使用 LightCut
    
    // 判断是否使用 BizyAir
    if (config.aiTaskType === 'bizyair_generate_media' && unifiedStore.hasBizyAirApiKey()) {
      provider = ProviderType.BIZYAIR
    }
    // 未来可以添加其他服务商的判断逻辑
    
    return {
      label: config.name[props.locale],
      value: key as ConfigKey,
      description: config.description[props.locale],
      provider,  // 添加服务商类型
    }
  })
})

// 检查文本是否需要显示省略号
const shouldShowEllipsis = (text: string, maxLength: number = 50): boolean => {
  return text.length > maxLength
}

// 过滤后的配置选项（参考 SearchableSelect.vue 的实现）
const filteredConfigOptions = computed<ConfigOption[]>(() => {
  if (!searchKeyword.value) {
    return configOptions.value
  }

  const query = searchKeyword.value.toLowerCase()
  
  return configOptions.value.filter((config) => {
    const label = config.label.toLowerCase()
    const description = config.description.toLowerCase()
    return label.includes(query) || description.includes(query)
  })
})

// 根据 contentType 获取对应的图标组件
const getIconForContentType = (configKey: ConfigKey): Component => {
  const config = collection[configKey]
  const contentType = config.contentType

  const iconMap: Record<string, Component> = {
    image: IconComponents.IMAGE_LARGE,
    video: IconComponents.VIDEO,
    audio: IconComponents.MUSIC,
  }

  return iconMap[contentType] || IconComponents.SPARKLING
}

// 切换到配置表单视图
const handleCardClick = (configKey: ConfigKey) => {
  emit('cardClick', configKey)
}

// 清除搜索
const clearSearch = () => {
  searchKeyword.value = ''
}
</script>

<style scoped>
/* 卡片网格视图容器 */
.card-grid-view {
  display: flex;
  flex-direction: column;
  height: 100%;
  overflow: hidden;
}

/* 搜索栏 */
.search-bar {
  padding: var(--spacing-md);
  border-bottom: 1px solid var(--color-border);
}

.search-input-wrapper {
  display: flex;
  align-items: center;
  gap: var(--spacing-sm);
  padding: var(--spacing-sm) var(--spacing-md);
  background: var(--color-bg-quaternary);
  border: 1px solid var(--color-border-secondary);
  border-radius: var(--border-radius-small);
  transition: border-color var(--transition-fast);
}

.search-input-wrapper:focus-within {
  border-color: var(--color-accent-secondary);
}

.search-icon {
  color: var(--color-text-hint);
  flex-shrink: 0;
}

.search-input {
  flex: 1;
  border: none;
  background: transparent;
  font-size: var(--font-size-sm);
  color: var(--color-text-primary);
  outline: none;
}

.search-input::placeholder {
  color: var(--color-text-hint);
}

.clear-button {
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 4px;
  background: transparent;
  border: none;
  color: var(--color-text-hint);
  cursor: pointer;
  border-radius: var(--border-radius-small);
  transition: all var(--transition-fast);
  flex-shrink: 0;
}

.clear-button:hover {
  background: var(--color-bg-tertiary);
  color: var(--color-text-secondary);
}

/* 卡片网格容器 */
.cards-grid {
  display: grid;
  /* 自动适应列数，每列最小宽度200px，最大1fr（平分剩余空间） */
  grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
  gap: var(--spacing-md);
  padding: var(--spacing-md);
  overflow-y: auto;
  flex: 1;
  align-content: flex-start;
}

/* 无搜索结果 */
.no-results {
  width: 100%;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: var(--spacing-xl);
  color: var(--color-text-hint);
}

.no-results-icon {
  margin-bottom: var(--spacing-md);
  opacity: 0.5;
}

.no-results-text {
  font-size: var(--font-size-sm);
  margin: 0;
}

/* 配置卡片 */
.config-card {
  display: flex;
  flex-direction: column;
  gap: var(--spacing-xs);
  padding: var(--spacing-md);
  background: var(--color-bg-secondary);
  border: 1px solid var(--color-border);
  border-radius: var(--border-radius-medium);
  cursor: pointer;
  transition: all 0.2s ease;
  /* 宽度由 grid 布局自动控制 */
  width: 100%;
  height: 80px;
}

.config-card:hover {
  border-color: var(--color-accent-primary);
  transform: translateY(-2px);
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);
  background: var(--color-bg-tertiary);
}

.config-card:active {
  transform: translateY(0);
}

/* 卡片头部 */
.card-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--spacing-xs);
  margin-bottom: var(--spacing-xs);
}

.header-left {
  display: flex;
  align-items: center;
  gap: var(--spacing-xs);
  flex: 1;
  min-width: 0;
}

.card-icon {
  flex-shrink: 0;
  color: var(--color-accent-primary);
}

.card-title {
  font-size: var(--font-size-sm);
  font-weight: 600;
  color: var(--color-text-primary);
  margin: 0;
  line-height: 1.2;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* 卡片描述 */
.card-description {
  font-size: var(--font-size-xs);
  color: var(--color-text-secondary);
  line-height: 1.2;
  flex: 1;
  margin: 0;
  display: -webkit-box;
  -webkit-box-orient: vertical;
  overflow: hidden;
  text-overflow: ellipsis;
  max-height: 3.6em; /* 3行文字的高度 */
  position: relative;
}

/* 添加省略号样式 */
.card-description::after {
  content: '...';
  position: absolute;
  bottom: 0;
  right: 0;
  color: var(--color-text-hint);
  font-size: var(--font-size-xs);
  line-height: 1;
  opacity: 0;
  transition: opacity 0.2s ease;
}

.card-description.show-ellipsis::after {
  opacity: 1;
}


/* 服务商 Logo 样式 */
.provider-logo {
  height: 20px;  /* 与原 card-tag 高度保持一致 */
  width: auto;
  object-fit: contain;
  flex-shrink: 0;
  border-radius: var(--border-radius-small);
  padding: 2px 4px;
}

</style>
