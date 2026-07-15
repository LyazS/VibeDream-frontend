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
        <HoverButton @click="loadSessions" variant="default" class="retry-button">
          {{ t('common.retry') }}
        </HoverButton>
      </div>

      <!-- 会话列表 -->
      <div v-else>
        <div
          v-for="session in filteredSessions"
          :key="session.session_id"
          class="history-item"
          @click="loadHistory(session.session_id)"
        >
          <div class="history-preview">
            {{ getPreviewText(session) }}
          </div>

          <div class="history-meta">
            <span class="history-time">
              {{ formatTime(session.updated_at) }}
            </span>

            <!-- 操作按钮 -->
            <div class="history-actions">
              <HoverButton
                @click.stop="deleteHistory(session.session_id)"
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
import { ref, computed, onMounted } from 'vue'
import { IconComponents } from '@/constants/iconComponents'
import HoverButton from '@/components/base/HoverButton.vue'
import { useAppI18n } from '@/core/composables/useI18n'
import { SESSION_MANAGER } from '@/aipanel/agent/services'
import type { SessionSummary } from '@/aipanel/agent/types'

const { t } = useAppI18n()

// 定义事件
const emit = defineEmits<{
  close: []
}>()

// 搜索查询
const searchQuery = ref('')

// 加载状态
const isLoading = ref(false)
const error = ref<string | null>(null)

// 会话列表数据
const sessions = ref<SessionSummary[]>([])

// 组件挂载时加载会话列表
onMounted(async () => {
  await loadSessions()
})

// 加载会话列表
const loadSessions = async () => {
  try {
    isLoading.value = true
    error.value = null
    sessions.value = await SESSION_MANAGER.getAllSessions()
  } catch (err) {
    error.value = err instanceof Error ? err.message : '加载会话列表失败'
    console.error('加载会话列表失败:', err)
  } finally {
    isLoading.value = false
  }
}

// 过滤后的会话列表
const filteredSessions = computed(() => {
  if (!searchQuery.value) {
    return sessions.value
  }

  const query = searchQuery.value.toLowerCase()
  return sessions.value.filter((session) => session.preview_text.toLowerCase().includes(query))
})

// 获取预览文本（现在直接从后端获取）
const getPreviewText = (session: SessionSummary): string => {
  return session.preview_text || '无消息内容'
}

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
const loadHistory = async (sessionId: string) => {
  try {
    await SESSION_MANAGER.restoreSession(sessionId)
    emit('close')
  } catch (err) {
    error.value = err instanceof Error ? err.message : '加载会话失败'
    console.error('加载会话失败:', err)
  }
}

// 删除历史记录
const deleteHistory = async (sessionId: string) => {
  try {
    await SESSION_MANAGER.deleteSession(sessionId)
    // 重新加载会话列表
    await loadSessions()
  } catch (err) {
    error.value = err instanceof Error ? err.message : '删除会话失败'
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
  transition: all 0.2s ease;
  background: var(--color-bg-secondary);
}

.history-item:hover {
  border-color: var(--color-accent-primary);
  border-width: 2px;
  background: var(--color-bg-hover);
  box-shadow: var(--shadow-sm);
  transform: translateY(-1px);
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
