<template>
  <UniversalModal
    :show="show"
    :title="t('user.userInfo')"
    @close="handleClose"
    @cancel="handleClose"
    :show-confirm="false"
    :show-cancel="false"
  >
    <div class="user-info-content">
      <div class="user-profile-summary">
        <div class="user-avatar">
          <component :is="IconComponents.USER" size="48px" />
        </div>

        <div class="user-details">
          <div class="detail-item">
            <span class="label">{{ t('user.username') }}：</span>
            <span class="value">{{ user.username }}</span>
          </div>

          <div v-if="user.email" class="detail-item">
            <span class="label">{{ t('user.email') }}：</span>
            <span class="value">{{ user.email }}</span>
          </div>

          <div class="detail-item">
            <span class="label">{{ t('user.balance') }}：</span>
            <span class="value">{{ formatMoneyForDisplay(user.balance) }}</span>
          </div>

          <div v-if="user.last_login_at" class="detail-item">
            <span class="label">{{ t('user.lastLogin') }}：</span>
            <span class="value">{{ formatDate(user.last_login_at) }}</span>
          </div>

          <!-- 激活码使用区域 -->
          <div class="activation-code-section">
            <ModalFormField>
              <div class="activation-code-input-group">
                <input
                  v-model="activationCode"
                  type="text"
                  :placeholder="t('user.activationCodePlaceholder')"
                  class="activation-code-input"
                  @keyup.enter="handleUseActivationCode"
                />
                <HoverButton
                  class="activation-code-use-button"
                  @click="handleUseActivationCode"
                  :disabled="!activationCode.trim() || isLoading"
                >
                  <template #icon>
                    <component :is="IconComponents.KEY" size="16px" />
                  </template>
                  {{ t('user.useActivationCode') }}
                </HoverButton>
              </div>
            </ModalFormField>
          </div>
        </div>
      </div>
    </div>

    <template #footer>
      <div class="user-info-actions">
        <button class="action-btn logout" @click="handleLogout">
          <component :is="IconComponents.LOGOUT" size="16px" />
          {{ t('user.logout') }}
        </button>
      </div>
    </template>
  </UniversalModal>
</template>

<script setup lang="ts">
import UniversalModal from './UniversalModal.vue'
import ModalFormField from '@/components/base/ModalFormField.vue'
import HoverButton from '@/components/base/HoverButton.vue'
import { IconComponents } from '@/constants/iconComponents'
import { useAppI18n } from '@/core/composables/useI18n'
import { useUnifiedStore } from '@/core/unifiedStore'
import type { User } from '@/core/modules/UnifiedUserModule'
import { ref, watch } from 'vue'
import { formatMoneyForDisplay } from '@/utils/money'

const { t } = useAppI18n()
const unifiedStore = useUnifiedStore()

// 激活码相关状态
const activationCode = ref('')
const isLoading = ref(false)

// 定义props
const props = defineProps<{
  show: boolean
  user: User
}>()

// 定义emits
const emit = defineEmits<{
  close: []
}>()

watch(
  () => props.show,
  (visible) => {
    if (visible) {
      void unifiedStore.refreshBalance()
    }
  },
  { immediate: true },
)

// 方法
function handleClose() {
  emit('close')
}

function formatDate(dateString: string): string {
  const date = new Date(dateString)
  return date.toLocaleString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function handleLogout() {
  // 执行退出登录（成功消息已在 UnifiedUserModule 中发出）
  unifiedStore.logout()
  // 关闭对话框
  emit('close')
}

// 使用激活码
async function handleUseActivationCode() {
  const code = activationCode.value.trim()
  if (!code) {
    return
  }

  isLoading.value = true

  try {
    // 使用 UnifiedUserModule 中的激活码使用功能
    await unifiedStore.useActivationCode(code)

    // 清空输入框
    activationCode.value = ''

    // 更新用户余额信息（通过模块自动更新，这里只需要触发响应式更新）
    if (props.user) {
      // 从 store 获取最新的用户信息
      const currentUser = unifiedStore.currentUser
      if (currentUser) {
        props.user.balance = currentUser.balance
      }
    }
  } catch (error) {
    // 错误处理已经在 UnifiedUserModule 中完成，这里不需要额外处理
    console.warn('激活码使用失败:', error)
  } finally {
    isLoading.value = false
  }
}
</script>

<style scoped>
/* 通用Modal的样式已经包含在UniversalModal组件中 */
/* 这里只需要定义内容区域特有的样式 */
.user-info-content {
  padding: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--spacing-lg);
}

.user-profile-summary {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 2fr);
  gap: var(--spacing-lg);
  align-items: center;
  width: 100%;
}

.user-avatar {
  width: 80px;
  height: 80px;
  border-radius: 50%;
  background-color: var(--color-bg-secondary);
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--color-text-secondary);
  border: 2px solid var(--color-border);
  justify-self: center;
}

.user-details {
  min-width: 0;
}

.detail-item {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: var(--spacing-sm) 0;
  border-bottom: 1px solid var(--color-border-light);
}

.detail-item:last-child {
  border-bottom: none;
}

.label {
  color: var(--color-text-secondary);
  font-size: var(--font-size-sm);
  font-weight: 500;
}

.value {
  color: var(--color-text-primary);
  font-size: var(--font-size-sm);
}

.value.active {
  color: var(--color-success);
}

.value.inactive {
  color: var(--color-error);
}

.user-info-actions {
  padding: 0;
  display: flex;
  flex-wrap: wrap;
  gap: var(--spacing-sm);
}

.action-btn {
  padding: var(--spacing-sm) var(--spacing-md);
  border: none;
  border-radius: var(--border-radius-small);
  font-size: var(--font-size-sm);
  font-weight: 500;
  cursor: pointer;
  transition: all 0.2s ease;
  display: flex;
  align-items: center;
  gap: var(--spacing-xs);
  flex: 1;
  min-width: 120px;
  justify-content: center;
}

.action-btn.logout {
  background-color: var(--color-error);
  color: white;
  width: 100%;
  min-width: 200px;
  margin: 0 auto;
}

.action-btn.logout:hover {
  background-color: var(--color-accent-error-hover);
}

/* 激活码使用区域样式 */
.activation-code-section {
  width: 100%;
  margin-top: var(--spacing-md);
  padding-top: var(--spacing-md);
  border-top: 1px solid var(--color-border-light);
}

.activation-code-input-group {
  display: flex;
  gap: var(--spacing-sm);
  align-items: stretch;
}

.activation-code-input {
  flex: 4; /* 80% 宽度 */
}

.activation-code-use-button {
  flex: 1;
  min-width: 80px;
  min-height: 36px;
  flex-shrink: 0;
  align-self: stretch;
  box-sizing: border-box;
}

</style>
