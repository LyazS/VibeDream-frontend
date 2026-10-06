<template>
  <div class="history-panel">
    <!-- 搜索框 -->
    <div class="search-container">
      <div class="search-input">
        <component :is="IconComponents.SEARCH" size="16px" />
        <input
          type="text"
          v-model="searchQuery"
          :placeholder="t('common.search')"
          class="search-field"
          autocomplete="off"
        />
      </div>

      <!-- 完成按钮 -->
      <HoverButton
        @click="handleBack"
        variant="default"
        :title="t('common.done')"
        class="done-button"
      >
        {{ t('common.done') }}
      </HoverButton>
    </div>

    <!-- 历史记录列表 -->
    <div class="history-list">
      <!-- 加载状态 -->
      <div v-if="isLoading" class="empty-state">
        <component :is="IconComponents.LOADING" size="48px" class="loading-icon" />
        <p>{{ t('common.loading') }}</p>
      </div>

      <!-- 错误状态 -->
      <div v-else-if="error" class="empty-state">
        <component :is="IconComponents.WARNING" size="48px" />
        <p>{{ error }}</p>
      </div>

      <!-- 会话列表 -->
      <div v-else>
        <div
          v-for="session in filteredSessions"
          :key="session.id"
          class="history-item"
          :class="{ 'history-item--selected': session.id === store.agentSessionId }"
          tabindex="0"
          role="button"
          @click="loadHistory(session.id)"
          @keydown.enter.self="loadHistory(session.id)"
          @keydown.space.self.prevent="loadHistory(session.id)"
        >
          <div class="history-preview">
            {{ session.preview || t('common.chat.new') }}
          </div>

          <div class="history-meta">
            <span class="history-time">
              {{ formatTime(session.updatedAt) }}
            </span>
            <span v-if="session.running" class="history-status">{{
              t('aiPanel.agentStatus.running')
            }}</span>
            <span v-else-if="session.waiting" class="history-status">{{
              t('aiPanel.agentStatus.waiting')
            }}</span>

            <!-- 操作按钮 -->
            <div class="history-actions">
              <HoverButton
                @click.stop="deleteHistory(session.id)"
                :disabled="session.running"
                variant="default"
                :title="t('common.delete')"
                class="action-button"
              >
                <template #icon>
                  <component :is="IconComponents.DELETE" size="16px" />
                </template>
              </HoverButton>
            </div>
          </div>
        </div>

        <!-- 空状态 -->
        <div v-if="filteredSessions.length === 0" class="empty-state">
          <component :is="IconComponents.HISTORY" size="48px" />
          <p>{{ t('common.chat.noHistory') }}</p>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue'
import { IconComponents } from '@/constants/iconComponents'
import HoverButton from '@/components/base/HoverButton.vue'
import { useAppI18n } from '@/core/composables/useI18n'
import { useUnifiedStore } from '@/core/unifiedStore'

const { t } = useAppI18n()
const store = useUnifiedStore()

// 定义事件
const emit = defineEmits<{
  close: []
}>()

// 搜索查询
const searchQuery = ref('')

// 加载状态
const isLoading = computed(() => store.agentHistoryLoading)
const deleteError = ref<string | null>(null)
const error = computed(() => deleteError.value || store.agentStorageError)

// 过滤后的会话列表
const filteredSessions = computed(() => {
  if (!searchQuery.value) {
    return store.agentSessionHistory
  }

  const query = searchQuery.value.toLowerCase()
  return store.agentSessionHistory.filter((session) =>
    session.preview.toLowerCase().includes(query),
  )
})

// 格式化时间显示
const formatTime = (dateString: string): string => {
  const date = new Date(dateString)
  const now = new Date()
  const diffTime = Math.abs(now.getTime() - date.getTime())
  const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24))

  if (diffDays === 1) {
    return t('common.today')
  } else if (diffDays === 2) {
    return t('common.yesterday')
  } else if (diffDays <= 7) {
    return `${diffDays} ${t('common.daysAgo')}`
  } else {
    return date.toLocaleDateString('zh-CN')
  }
}

// 加载历史记录
const loadHistory = (sessionId: string) => {
  if (store.selectAgentSession(sessionId)) emit('close')
}

// 删除历史记录
const deleteHistory = async (sessionId: string) => {
  try {
    deleteError.value = null
    await store.deleteAgentSession(sessionId)
  } catch (err) {
    deleteError.value = err instanceof Error ? err.message : '删除会话失败'
    console.error('删除会话失败:', err)
  }
}

// 返回按钮处理
const handleBack = () => {
  emit('close')
}
</script>

<style scoped>
.history-panel {
  width: 100%;
  height: 100%;
  display: flex;
  flex-direction: column;
  background: var(--color-bg-secondary);
}

.search-container {
  padding: var(--spacing-md);
  padding-top: var(--spacing-lg);
  display: flex;
  align-items: center;
  gap: var(--spacing-sm);
}

.search-input {
  position: relative;
  display: flex;
  align-items: center;
  flex: 1;
}

.search-input .remix-icon {
  position: absolute;
  left: var(--spacing-sm);
  color: var(--color-text-secondary);
}

.search-field {
  width: 100%;
  padding: var(--spacing-sm) var(--spacing-sm) var(--spacing-sm) var(--spacing-xl);
  border: none;
  border-radius: var(--border-radius-medium);
  background: var(--color-bg-secondary);
  color: var(--color-text-primary);
  font-size: var(--font-size-sm);
}

.search-field:focus {
  outline: none;
  border-color: var(--color-accent-primary);
  box-shadow: 0 0 0 2px var(--color-accent-primary-alpha);
}

.history-list {
  flex: 1;
  overflow-y: auto;
  padding: var(--spacing-sm);
}

.history-item {
  padding: var(--spacing-md);
  border-radius: var(--border-radius-medium);
  border: none;
  margin-bottom: var(--spacing-sm);
  cursor: pointer;
  transition: background-color 0.2s ease;
  background: var(--color-bg-secondary);
}

.history-item:hover {
  border-color: var(--color-accent-primary);
  border-width: 2px;
  background: var(--color-bg-hover);
  box-shadow: var(--shadow-sm);
}

.history-item--selected {
  box-shadow: inset 3px 0 0 var(--color-accent-primary);
}

/* hover 阴影与选中竖条叠加，避免 hover 规则优先级覆盖选中标记。 */
.history-item--selected:hover {
  box-shadow:
    inset 3px 0 0 var(--color-accent-primary),
    var(--shadow-sm);
}

.history-preview {
  overflow-wrap: anywhere;
}

.history-status {
  font-size: var(--font-size-sm);
  color: var(--color-text-secondary);
  white-space: nowrap;
}

.history-time {
  font-size: var(--font-size-xs);
  color: var(--color-text-tertiary);
  white-space: nowrap;
}

.history-preview {
  font-size: var(--font-size-sm);
  color: var(--color-text-secondary);
  margin-bottom: var(--spacing-xs);
  line-height: 1.4;
}

.history-meta {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.history-actions {
  display: flex;
  gap: var(--spacing-xs);
  align-items: center;
}

.action-button {
  padding: var(--spacing-xs);
}

.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: var(--spacing-xxl);
  color: var(--color-text-tertiary);
  text-align: center;
}

.empty-state .remix-icon {
  margin-bottom: var(--spacing-md);
  opacity: 0.5;
}

.empty-state p {
  margin: 0;
  font-size: var(--font-size-sm);
}

.done-button {
  white-space: nowrap;
  flex-shrink: 0;
}

.loading-icon {
  animation: spin 1s linear infinite;
}

@keyframes spin {
  from {
    transform: rotate(0deg);
  }
  to {
    transform: rotate(360deg);
  }
}

.retry-button {
  margin-top: var(--spacing-md);
}
</style>
