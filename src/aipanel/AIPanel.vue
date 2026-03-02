<template>
  <div class="panel">
    <n-tabs v-model:value="unifiedStore.aiPanelActiveTab" type="line" animated style="padding: 0 var(--spacing-md)">
      <template #prefix>
        <component :is="IconComponents.SPARKLING" size="16px" style="padding: 0" />
      </template>
      <n-tab name="ai-generate" :tab="t('aiPanel.aiGenerate')"> </n-tab>
      <n-tab name="agent" :tab="t('aiPanel.agent')"> </n-tab>
      <n-tab v-if="unifiedStore.canShowCharacterEditor" name="character-editor" :tab="t('aiPanel.characterEditor')"> </n-tab>
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
    <div v-show="unifiedStore.aiPanelActiveTab === 'ai-generate'" style="flex: 1; display: flex; flex-direction: column; overflow: hidden;">
      <GeneratePanel />
    </div>
    <div v-show="unifiedStore.aiPanelActiveTab === 'agent'" style="flex: 1; display: flex; flex-direction: column; overflow: hidden;">
      <AgentPanel :showHistory="showHistory" />
    </div>
    <div v-show="unifiedStore.aiPanelActiveTab === 'character-editor'" style="flex: 1; display: flex; flex-direction: column; overflow: hidden;">
      <CharacterEditor />
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, onUnmounted } from 'vue'
import { NTab, NTabs } from 'naive-ui'
import { IconComponents } from '@/constants/iconComponents'
import HoverButton from '@/components/base/HoverButton.vue'
import AgentPanel from './agent/components/AgentPanel.vue'
import GeneratePanel from './aigenerate/GeneratePanel.vue'
import CharacterEditor from './character/CharacterEditor.vue'
import { useAppI18n } from '@/core/composables/useI18n'
import { useUnifiedStore } from '@/core/unifiedStore'
import { SESSION_MANAGER } from '@/aipanel/agent/services'

const { t } = useAppI18n()
const unifiedStore = useUnifiedStore()

// 定义事件
const emit = defineEmits<{
  close: []
}>()

// 是否显示历史记录面板
const showHistory = ref(false)

// 组件挂载时不需要额外初始化，SessionManager 构造函数已显示欢迎消息
onMounted(() => {
  console.log('聊天面板已挂载')
})

// 组件卸载时清理资源
onUnmounted(() => {
  // 清理进行中的消息请求
  SESSION_MANAGER.abortCurrentMessage()
})

// 处理新建聊天 - 只清空消息列表，不创建新会话
const handleNewChat = async () => {
  try {
    // 只清空当前会话的消息，不创建新会话
    SESSION_MANAGER.clearCurrentSession()
    console.log('消息列表已清空，准备开始新对话')
  } catch (error) {
    console.error('清空消息列表失败:', error)
  }
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
