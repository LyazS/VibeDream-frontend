<template>
  <div class="panel">
    <!-- 卡片网格视图 -->
    <ConfigCardGrid
      v-if="viewMode === 'card_grid'"
      :locale="currentLang"
      @card-click="handleCardClick"
    />

    <!-- 配置表单视图 -->
    <ConfigFormView
      v-else
      :selected-config="selectedConfig"
      :ui-config="uiConfig"
      :ai-config="aiConfig"
      :is-generating="isGenerating"
      :locale="currentLang"
      @back="handleBack"
      @generate="handleGenerate"
      @debug-output="handleDebugOutput"
      @update:aiConfig="handleAiConfigUpdate"
    />
  </div>
</template>

<script setup lang="ts">
import ConfigCardGrid from './ConfigCardGrid.vue'
import ConfigFormView from './ConfigFormView.vue'
import { useAIGeneration } from './composables/useAIGeneration'

// 使用 AI 生成 composable
const {
  // 状态
  viewMode,
  selectedConfig,
  uiConfig,
  aiConfig,
  isGenerating,
  currentLang,

  // 配置管理方法
  handleCardClick,
  handleBack,
  handleAiConfigUpdate,

  // 生成处理方法
  handleGenerate,
  handleDebugOutput,
} = useAIGeneration()

</script>

<style scoped>
.panel {
  display: flex;
  flex-direction: column;
  height: 100%;
  overflow: hidden;
}
</style>
