<template>
  <UniversalModal
    :show="show"
    @close="handleCancel"
    @confirm="handleSubmit"
    @cancel="handleCancel"
    :show-cancel="false"
    :show-confirm="false"
    :show-footer="false"
    :loading="isLoading"
  >
    <template #header>
      <div class="login-header">
        <img src="/icon/favicon.svg" alt="Logo" class="login-logo" />
        <h3 class="login-title">
          {{ isRegisterMode ? t('user.registerTitle') : t('user.loginTitle') }}
        </h3>
      </div>
    </template>
    <form @submit.prevent="handleSubmit" class="login-form">
      <ModalFormField :label="t('user.username')" input-id="username">
        <input
          id="username"
          v-model="formData.username"
          type="text"
          required
          :placeholder="t('user.usernamePlaceholder')"
          :disabled="isLoading"
        />
      </ModalFormField>

      <ModalFormField :label="t('user.password')" input-id="password">
        <input
          id="password"
          v-model="formData.password"
          type="password"
          required
          :placeholder="t('user.passwordPlaceholder')"
          :disabled="isLoading"
        />
      </ModalFormField>

      <ModalFormField
        v-if="isRegisterMode"
        :label="t('user.confirmPassword')"
        input-id="confirm-password"
      >
        <input
          id="confirm-password"
          v-model="formData.confirmPassword"
          type="password"
          required
          :placeholder="t('user.confirmPasswordPlaceholder')"
          :disabled="isLoading"
        />
      </ModalFormField>

      <div class="error-message" v-if="errorMessage">
        {{ errorMessage }}
      </div>

      <div class="form-actions">
        <button type="submit" class="submit-btn" :disabled="isLoading">
          {{
            isLoading
              ? t('common.processing')
              : isRegisterMode
                ? t('user.registerButton')
                : t('user.loginButton')
          }}
        </button>

        <button type="button" class="switch-mode-btn" @click="switchMode" :disabled="isLoading">
          {{ isRegisterMode ? t('user.hasAccount') : t('user.noAccount') }}
        </button>
      </div>
    </form>
  </UniversalModal>
</template>

<script setup lang="ts">
import { ref, reactive } from 'vue'
import UniversalModal from './UniversalModal.vue'
import ModalFormField from '@/components/base/ModalFormField.vue'
import { useUnifiedStore } from '@/core/unifiedStore'
import { useAppI18n } from '@/core/composables/useI18n'
import type { User } from '@/core/modules/UnifiedUserModule'

const unifiedStore = useUnifiedStore()
const { t } = useAppI18n()

// 定义props
const props = defineProps<{
  show: boolean
}>()

// 定义emits
const emit = defineEmits<{
  close: []
}>()

// 响应式数据
const isLoading = ref(false)
const isRegisterMode = ref(false)
const errorMessage = ref('')

const formData = reactive({
  username: '',
  password: '',
  confirmPassword: '',
})

// 方法
function handleOverlayClick() {
  handleCancel()
}

function handleCancel() {
  if (!isLoading.value) {
    emit('close')
    resetForm()
  }
}

function resetForm() {
  formData.username = ''
  formData.password = ''
  formData.confirmPassword = ''
  errorMessage.value = ''
}

function switchMode() {
  isRegisterMode.value = !isRegisterMode.value
  errorMessage.value = ''
}

async function handleSubmit() {
  if (isLoading.value) return

  // 验证表单
  if (!formData.username || !formData.password) {
    errorMessage.value = t('user.usernameRequired') + '、' + t('user.passwordRequired')
    return
  }

  if (isRegisterMode.value) {
    if (formData.password !== formData.confirmPassword) {
      errorMessage.value = t('user.passwordMismatchError')
      return
    }
    if (formData.password.length < 8 || formData.password.length > 50) {
      errorMessage.value = t('user.passwordLengthError')
      return
    }
    if (!/[a-zA-Z]/.test(formData.password) || !/\d/.test(formData.password)) {
      errorMessage.value = t('user.passwordCharacterError')
      return
    }
  }

  isLoading.value = true
  errorMessage.value = ''

  try {
    if (isRegisterMode.value) {
      // 注册用户（注册成功后会自动保存认证信息）
      await unifiedStore.register(formData.username, formData.password)

      // 关闭对话框（成功消息已在 UnifiedUserModule 中发出）
      emit('close')
    } else {
      // 用户登录
      const response = await unifiedStore.login(formData.username, formData.password)

      // 关闭对话框（成功消息已在 UnifiedUserModule 中发出）
      emit('close')
    }
  } catch (error: any) {
    console.error('登录/注册失败:', error)
    errorMessage.value = error.message || t('user.loginFailed')
  } finally {
    isLoading.value = false
  }
}
</script>

<style scoped>
/* 登录头部样式 */
.login-header {
  display: flex;
  align-items: center;
  gap: var(--spacing-md);
}

.login-logo {
  width: 48px;
  height: 48px;
  object-fit: contain;
}

.login-title {
  margin: 0;
  color: var(--color-text-primary);
  font-size: 18px;
  font-weight: 600;
}

/* 通用Modal的样式已经包含在UniversalModal组件中 */
/* 这里只需要定义内容区域特有的样式 */
.login-form {
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: var(--spacing-md);
}

.login-form input:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.error-message {
  color: var(--color-error);
  font-size: var(--font-size-xs);
  padding: var(--spacing-xs) var(--spacing-sm);
  background-color: rgba(255, 68, 68, 0.1);
  border-radius: var(--border-radius-small);
}

.form-actions {
  display: flex;
  flex-direction: column;
  gap: var(--spacing-sm);
}

.submit-btn {
  padding: var(--spacing-sm) var(--spacing-md);
  background-color: var(--color-primary);
  color: white;
  border: none;
  border-radius: var(--border-radius-small);
  font-size: var(--font-size-sm);
  font-weight: 500;
  cursor: pointer;
  transition: background-color 0.2s ease;
}

.submit-btn:hover:not(:disabled) {
  background-color: var(--color-primary-hover);
}

.submit-btn:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.switch-mode-btn {
  padding: var(--spacing-sm) var(--spacing-md);
  background: none;
  color: var(--color-text-secondary);
  border: 1px solid var(--color-border);
  border-radius: var(--border-radius-small);
  font-size: var(--font-size-sm);
  cursor: pointer;
  transition: all 0.2s ease;
}

.switch-mode-btn:hover:not(:disabled) {
  background-color: var(--color-bg-hover);
  color: var(--color-text-primary);
}

.switch-mode-btn:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}
</style>
