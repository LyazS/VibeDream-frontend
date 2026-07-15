<template>
  <div class="config-form-view">
    <!-- 返回按钮 -->
    <button class="back-button" @click="handleBack">
      <component :is="IconComponents.PREV_KEYFRAME" size="16px" />
      <span>{{ t('aiPanel.back') }}</span>
    </button>

    <!-- 配置标题和描述 -->
    <div class="config-header">
      <h2 class="config-title">
        <component
          :is="selectedConfig ? getIconForContentType(selectedConfig) : IconComponents.SPARKLING"
          size="24px"
          class="title-icon"
        />
        {{ selectedConfigData?.name[locale] }}
      </h2>
      <p class="config-description">
        {{ selectedConfigData?.description[locale] }}
      </p>
    </div>

    <!-- 动态配置表单 -->
    <n-scrollbar style="flex: 1; max-height: 100%; padding: var(--spacing-md) var(--spacing-xl)">
      <div class="scrollable-content">
        <DynamicConfigForm
          v-if="uiConfig && aiConfig"
          :uiConfig="uiConfig"
          :aiConfig="aiConfig"
          :locale="locale"
          :validationErrors="validationResult.errorsByPath"
          @update:aiConfig="handleAiConfigUpdate"
        />

        <!-- 发送按钮 -->
        <n-tooltip :disabled="!generateButtonTooltip" placement="top">
          <template #trigger>
            <button
              v-if="aiConfig"
              class="generate-button"
              :class="{ 'button-invalid': !isFormValid }"
              :disabled="isGenerateDisabled"
              @click="handleGenerate"
            >
              <component :is="IconComponents.SPARKLING" size="16px" class="button-icon" />
              <span>{{ isGenerating ? t('aiPanel.generating') : t('aiPanel.generate') }}<template v-if="shouldShowCost"> ({{ calculatedCost }}$)</template></span>
            </button>
          </template>
          {{ generateButtonTooltip }}
        </n-tooltip>

        <!-- 调试输出按钮 -->
        <!-- <button v-if="aiConfig" class="generate-button" @click="handleDebugOutput">
          <component :is="IconComponents.DEBUG" size="16px" class="button-icon" />
          <span>调试输出</span>
        </button> -->
      </div>
    </n-scrollbar>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { NScrollbar, NTooltip } from 'naive-ui'
import DynamicConfigForm from './DynamicConfigForm.vue'
import { collection, type ConfigKey } from '@/aipanel/aigenerate/configs'
import { IconComponents } from '@/constants/iconComponents'
import { useAppI18n } from '@/core/composables/useI18n'
import type { Component } from 'vue'
import type { UIConfig, ValidationResult } from '@/aipanel/aigenerate/types'
import { calculateTotalCost } from './utils/costCalculator'
import { validateAiConfig } from './utils/validator'
import { useUnifiedStore } from '@/core/unifiedStore'
import { formatMoneyForDisplay } from '@/utils/money'

interface Props {
  selectedConfig: ConfigKey | ''
  uiConfig: UIConfig[] | null
  aiConfig: Record<string, any> | null
  isGenerating: boolean
  locale: 'zh' | 'en'
}

interface Emits {
  (e: 'back'): void
  (e: 'generate'): void
  (e: 'debugOutput'): void
  (e: 'update:aiConfig', value: Record<string, any>): void
}

const props = defineProps<Props>()
const emit = defineEmits<Emits>()

// 使用全局 i18n 获取翻译函数
const { t } = useAppI18n()

// 获取 unified store 实例
const unifiedStore = useUnifiedStore()

// 是否显示成本（有 BizyAir API Key 时不显示）
const shouldShowCost = computed(() => !unifiedStore.hasBizyAirApiKey())

// 获取选中的配置数据
const selectedConfigData = computed(() => {
  if (!props.selectedConfig) return null
  return collection[props.selectedConfig]
})

// 计算动态成本
const calculatedCost = computed(() => {
  if (!props.selectedConfig || !props.aiConfig) return '0.00'
  const config = collection[props.selectedConfig]
  const cost = calculateTotalCost(config, props.aiConfig)
  return formatMoneyForDisplay(cost)
})

// 计算验证结果
const validationResult = computed<ValidationResult>(() => {
  if (!props.uiConfig || !props.aiConfig) {
    return {
      isValid: false,
      errors: [],
      errorsByPath: new Map()
    }
  }
  return validateAiConfig(props.uiConfig, props.aiConfig, props.locale)
})

// 表单是否有效
const isFormValid = computed(() => validationResult.value.isValid)

// 生成按钮是否禁用
const isGenerateDisabled = computed(() => {
  return props.isGenerating || !isFormValid.value
})

// 获取生成按钮的提示文本
const generateButtonTooltip = computed(() => {
  if (props.isGenerating) {
    return props.locale === 'zh' ? '生成中...' : 'Generating...'
  }
  if (!isFormValid.value) {
    const errorCount = validationResult.value.errors.length
    return props.locale === 'zh'
      ? `请完成 ${errorCount} 个必填字段`
      : `Please complete ${errorCount} required field(s)`
  }
  return ''
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

// 返回到卡片网格视图
const handleBack = () => {
  emit('back')
}

// 处理生成按钮点击
const handleGenerate = () => {
  emit('generate')
}

// 处理调试输出按钮点击
const handleDebugOutput = () => {
  emit('debugOutput')
}

// 处理 AI 配置更新
const handleAiConfigUpdate = (value: Record<string, any>) => {
  emit('update:aiConfig', value)
}
</script>

<style scoped>
/* 配置表单视图 */
.config-form-view {
  display: flex;
  flex-direction: column;
  height: 100%;
  overflow: hidden;
}

/* 返回按钮 */
.back-button {
  display: flex;
  align-items: center;
  gap: var(--spacing-xs);
  padding: var(--spacing-sm) var(--spacing-md);
  background: transparent;
  border: 1px solid var(--color-border);
  border-radius: var(--border-radius-small);
  color: var(--color-text-secondary);
  font-size: var(--font-size-sm);
  cursor: pointer;
  transition: all 0.2s ease;
  margin: var(--spacing-md) var(--spacing-md) 0;
  align-self: flex-start;
}

.back-button:hover {
  background: var(--color-bg-secondary);
  color: var(--color-text-primary);
  border-color: var(--color-accent-primary);
}

/* 配置头部 */
.config-header {
  padding: var(--spacing-md) var(--spacing-xl);
  border-bottom: 1px solid var(--color-border);
}

.config-title {
  display: flex;
  align-items: center;
  gap: var(--spacing-sm);
  font-size: var(--font-size-lg);
  font-weight: 600;
  color: var(--color-text-primary);
  margin: 0 0 var(--spacing-xs) 0;
}

.title-icon {
  color: var(--color-accent-primary);
}

.config-description {
  font-size: var(--font-size-sm);
  color: var(--color-text-secondary);
  line-height: 1.5;
  margin: 0;
}

.scrollable-content {
  padding-bottom: var(--spacing-md);
  display: flex;
  flex-direction: column;
  gap: var(--spacing-md);
}

.generate-button {
  padding: var(--spacing-md);
  background: var(--color-accent-primary);
  color: white;
  border: none;
  border-radius: var(--border-radius-small);
  font-size: var(--font-size-sm);
  font-weight: 500;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: var(--spacing-xs);
  transition: all 0.2s ease;
}

.generate-button:hover:not(:disabled) {
  background: var(--color-accent-primary-hover);
  transform: translateY(-1px);
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.15);
}

.generate-button:active:not(:disabled) {
  transform: translateY(0);
}

.generate-button:disabled {
  background: var(--color-bg-quaternary);
  color: var(--color-text-hint);
  cursor: not-allowed;
  opacity: 0.6;
}

/* 无效状态的按钮样式 */
.generate-button.button-invalid {
  background: var(--color-bg-quaternary);
  color: var(--color-text-hint);
  cursor: not-allowed;
  opacity: 0.6;
}

.generate-button.button-invalid:hover {
  transform: none;
  box-shadow: none;
}

.button-icon {
  flex-shrink: 0;
}
</style>
