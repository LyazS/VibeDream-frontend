<template>
  <div class="panel">
    <n-tabs
      v-model:value="unifiedStore.aiPanelActiveTab"
      type="line"
      animated
      style="padding: 0 var(--spacing-md)"
    >
      <template #prefix>
        <component :is="IconComponents.SPARKLING" size="16px" style="padding: 0" />
      </template>
      <!-- <n-tab name="ai-generate" :tab="t('aiPanel.aiGenerate')"> </n-tab> -->
      <n-tab name="agent" :tab="t('aiPanel.agent')"> </n-tab>
      <n-tab v-if="showItemPropertyTest" name="item-property-test" tab="属性描述"> </n-tab>
      <n-tab v-if="showMediaSearchTest" name="media-search-test" tab="素材搜索测试"> </n-tab>
      <n-tab v-if="showTransitionTest" name="transition-test" tab="转场测试"> </n-tab>
      <template #suffix>
        <div class="header-buttons">
          <template v-if="unifiedStore.aiPanelActiveTab === 'agent'">
            <HoverButton @click="handleNewChat" :title="t('common.chat.new')">
              <template #icon>
                <component :is="IconComponents.ADD" size="18px" />
              </template>
            </HoverButton>
            <HoverButton @click="showHistory = !showHistory" :title="t('common.chat.history')">
              <template #icon>
                <component :is="IconComponents.HISTORY" size="18px" />
              </template>
            </HoverButton>
          </template>
          <HoverButton @click="$emit('close')" :title="t('common.close')">
            <template #icon>
              <component :is="IconComponents.CLOSE" size="18px" />
            </template>
          </HoverButton>
        </div>
      </template>
    </n-tabs>
    <div
      v-show="unifiedStore.aiPanelActiveTab === 'ai-generate'"
      style="flex: 1; display: flex; flex-direction: column; overflow: hidden"
    >
      <GeneratePanel />
    </div>
    <div
      v-show="unifiedStore.aiPanelActiveTab === 'agent'"
      style="flex: 1; display: flex; flex-direction: column; overflow: hidden"
    >
      <AgentPanel v-model:showHistory="showHistory" />
    </div>
    <div
      v-if="showMediaSearchTest"
      v-show="unifiedStore.aiPanelActiveTab === 'media-search-test'"
      style="flex: 1; display: flex; flex-direction: column; overflow: hidden"
    >
      <MediaSearchTestPanel />
    </div>
    <div
      v-if="showTransitionTest"
      v-show="unifiedStore.aiPanelActiveTab === 'transition-test'"
      style="flex: 1; display: flex; flex-direction: column; overflow: hidden"
    >
      <TransitionTestPanel />
    </div>
    <div
      v-if="showItemPropertyTest"
      v-show="unifiedStore.aiPanelActiveTab === 'item-property-test'"
      style="flex: 1; display: flex; flex-direction: column; overflow: hidden; min-height: 0"
    >
      <ItemPropertyTestPanel />
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import { NTab, NTabs } from 'naive-ui'
import { IconComponents } from '@/constants/iconComponents'
import HoverButton from '@/components/base/HoverButton.vue'
import AgentPanel from './agent/components/AgentPanel.vue'
import MediaSearchTestPanel from './agent/components/MediaSearchTestPanel.vue'
import TransitionTestPanel from './agent/components/TransitionTestPanel.vue'
import ItemPropertyTestPanel from './agent/components/ItemPropertyTestPanel.vue'
import GeneratePanel from './aigenerate/GeneratePanel.vue'
import { useAppI18n } from '@/core/composables/useI18n'
import { useUnifiedStore } from '@/core/unifiedStore'

const { t } = useAppI18n()
const unifiedStore = useUnifiedStore()
const showMediaSearchTest = import.meta.env.DEV || import.meta.env.MODE === 'preview'
const showTransitionTest = import.meta.env.MODE === 'preview'
const showItemPropertyTest = import.meta.env.DEV || import.meta.env.MODE === 'preview'

// 定义事件
defineEmits<{
  close: []
}>()

// 是否显示历史记录面板
const showHistory = ref(false)

const handleNewChat = () => {
  showHistory.value = false
  unifiedStore.newAgentChat()
}
</script>

<style scoped>
/* 确保聊天面板占满整个高度 */
.panel {
  width: 100%;
  height: 100%;
  display: flex;
  flex-direction: column;
}
.header-buttons {
  display: flex;
  gap: var(--spacing-sm);
  align-items: center;
}
</style>
