<template>
  <div
    class="status-bar-container"
    :class="{ 'loading-hidden': unifiedStore.showProjectLoadingProgress }"
  >
    <div class="status-bar">
      <div class="status-content">
        <!-- 左侧：返回按钮和保存状态 -->
        <div class="status-left">
          <HoverButton @click="goBack" :title="t('editor.backToProject')">
            <template #icon>
              <img src="/icon/favicon.ico" alt="back" style="width: 18px; height: 18px;" />
            </template>
            {{ t('editor.back') }}
          </HoverButton>
          <HoverButton @click="saveProject" :disabled="isSaving" :title="t('editor.save')">
            <span class="project-status">{{ projectStatus }}</span>
          </HoverButton>
        </div>

        <!-- 中间：项目名称 -->
        <div class="status-center">
          <HoverButton @click="showEditProjectDialog" :title="t('editor.editProjectInfo')">
            <span class="project-title">{{
              unifiedStore.projectName || t('editor.untitledProject')
            }}</span>
            <template #icon>
              <component :is="IconComponents.EDIT" size="18px" class="edit-icon" />
            </template>
          </HoverButton>
        </div>

        <!-- 右侧：功能按钮组 -->
        <div class="status-right">
          <!-- 左侧按钮组 -->
          <div class="button-group-left">
            <ActiveTaskIndicator />

            <LanguageSelector />

            <HoverButton @click="showOriginalUniversalModal = true" title="展示原始 UniversalModal">
              UniversalModal
            </HoverButton>

            <HoverButton
              @click="showProviderConfigDialog = true"
              :title="t('app.apiConfigCenter')"
            >
              <template #icon>
                <img src="/logo-3rd/logo-bizyair-only.webp" alt="BizyAir" style="width: 16px; height: 16px;" />
              </template>
              <span v-if="!hasBizyAirKey" class="bizyair-key-text">Key</span>
            </HoverButton>

            <HoverButton
              @click="toggleChatPanel"
              :title="t('editor.toggleChatPanel')"
              :active="unifiedStore.isChatPanelVisible"
            >
              <template #icon>
                <component :is="IconComponents.CHAT_AI" size="16px" />
              </template>
            </HoverButton>

            <HoverButton
              @click="handleUserClick"
              :title="isUserLogin ? t('user.userInfo') : t('user.login')"
            >
              <template #icon>
                <component
                  :is="getUserStatusIcon(isUserLogin)"
                  size="16px"
                  :style="{ color: isUserLogin ? undefined : '#ff4444' }"
                />
              </template>
              <span v-if="!isUserLogin" class="login-text">{{ t('user.loginText') }}</span>
            </HoverButton>
          </div>

          <!-- 右侧按钮组：导出 -->
          <div class="button-group-right">
            <HoverButton @click="exportProject" :title="t('editor.export')">
              <template #icon>
                <component :is="IconComponents.DOWNLOAD" size="16px" />
              </template>
              {{ t('editor.export') }}
            </HoverButton>
          </div>
        </div>
      </div>
    </div>
  </div>

  <!-- 编辑项目对话框 -->
  <EditProjectModal
    :show="showEditDialog"
    :project="currentProject"
    :is-saving="isSaving"
    @close="showEditDialog = false"
    @save="handleSaveProject"
  />

  <!-- 登录对话框 -->
  <LoginModal :show="showLoginDialog" @close="showLoginDialog = false" />

  <!-- 用户信息对话框 -->
  <UserInfoModal
    v-if="currentUser"
    :show="showUserInfoDialog"
    :user="currentUser"
    @close="showUserInfoDialog = false"
  />

  <!-- 导出设置对话框 -->
  <ExportSettingsModal
    :show="showExportDialog"
    :default-title="unifiedStore.projectName"
    @close="showExportDialog = false"
    @export="handleExportWithSettings"
  />

  <!-- Provider配置对话框 -->
  <ProviderConfigModal
    :show="showProviderConfigDialog"
    @close="showProviderConfigDialog = false"
  />

  <!-- 原始通用弹窗预览 -->
  <UniversalModal v-model:show="showOriginalUniversalModal" />
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue'
import { useUnifiedStore } from '@/core/unifiedStore'
import HoverButton from '@/components/base/HoverButton.vue'
import LanguageSelector from '@/components/utils/LanguageSelector.vue'
import { IconComponents, getUserStatusIcon } from '@/constants/iconComponents'
import { exportProjectWithCancel } from '@/core/utils/projectExporter'
import EditProjectModal from '@/components/modals/EditProjectModal.vue'
import LoginModal from '@/components/modals/LoginModal.vue'
import UserInfoModal from '@/components/modals/UserInfoModal.vue'
import ExportSettingsModal from '@/components/modals/ExportSettingsModal.vue'
import ProviderConfigModal from '@/components/modals/ProviderConfigModal.vue'
import UniversalModal from '@/components/modals/UniversalModal.vue'
import ActiveTaskIndicator from '@/components/task-center/ActiveTaskIndicator.vue'
import { useAppI18n } from '@/core/composables/useI18n'
import type { Quality } from 'mediabunny'

const unifiedStore = useUnifiedStore()
const { t } = useAppI18n()

// 定义事件
const emit = defineEmits<{
  showEditProjectDialog: []
}>()

// 响应式数据
const showEditDialog = ref(false)
const showLoginDialog = ref(false)
const showUserInfoDialog = ref(false)
const showExportDialog = ref(false)
const showProviderConfigDialog = ref(false)
const showOriginalUniversalModal = ref(false)
const currentUser = computed(() => unifiedStore.getCurrentUser())
const isUserLogin = computed(() => unifiedStore.isLoggedIn)
const hasBizyAirKey = computed(() => unifiedStore.hasBizyAirApiKey())

// 导出取消函数引用
let cancelExport: (() => void) | null = null

// 计算属性
const projectStatus = computed(() => unifiedStore.projectStatus)
const isSaving = computed(() => unifiedStore.isProjectSaving)

// 当前项目配置对象（用于编辑对话框）
const currentProject = computed(() => {
  return {
    id: unifiedStore.projectId,
    name: unifiedStore.projectName,
    description: unifiedStore.projectDescription,
    createdAt: unifiedStore.projectCreatedAt,
    updatedAt: unifiedStore.projectUpdatedAt,
    version: unifiedStore.projectVersion,
    thumbnail: unifiedStore.projectThumbnail || undefined,
    duration: 0, // 未使用
    settings: {
      videoResolution: unifiedStore.videoResolution,
      timelineDurationFrames: unifiedStore.timelineDurationFrames,
    },
  }
})

// 方法
function toggleChatPanel() {
  unifiedStore.setChatPanelVisible(!unifiedStore.isChatPanelVisible)
}

function goBack() {
  console.log('🔙 使用页面重载方式返回项目管理')
  window.location.href = '/'
}

async function saveProject() {
  if (isSaving.value) return

  try {
    const success = await unifiedStore.manualSave()
    if (success) {
      console.log('项目已手动保存')
    } else {
      console.warn('手动保存失败')
    }
  } catch (error) {
    console.error('保存项目失败:', error)
  }
}

function exportProject() {
  // 显示导出设置对话框
  showExportDialog.value = true
}

async function handleExportWithSettings(settings: {
  title: string
  exportType: 'video' | 'audio'
  videoQuality: Quality
  audioQuality: Quality
  frameRate: number
}) {
  try {
    // 关闭对话框
    showExportDialog.value = false

    await unifiedStore.pause()

    // 使用 createLoading 创建加载弹窗
    const loading = unifiedStore.createLoading({
      title: t('editor.exporting'),
      showProgress: true,
      showDetails: true,
      showTips: true,
      tipText: t('editor.exportTip'),
      showCancel: true,
      cancelText: t('common.cancel'),
      onCancel: () => {
        if (cancelExport) {
          cancelExport()
        }
      }
    })

    // 使用可取消的导出函数
    cancelExport = exportProjectWithCancel(
      {
        exportType: settings.exportType,
        videoWidth: unifiedStore.videoResolution.width,
        videoHeight: unifiedStore.videoResolution.height,
        projectName: settings.title,
        timelineItems: unifiedStore.timelineItems,
        tracks: unifiedStore.tracks,
        getMediaItem: (id: string) => unifiedStore.getMediaItem(id),
        getAsset: (id: string | null) => unifiedStore.getAsset(id),
        videoQuality: settings.videoQuality,
        audioQuality: settings.audioQuality,
        frameRate: settings.frameRate,
        onProgress: (stage: string, progress: number, details?: string) => {
          // 更新进度
          loading.update({
            progress: Math.max(0, Math.min(100, progress)),
            details: details || ''
          })
        },
      },
      // 成功回调
      () => {
        loading.close()
        cancelExport = null
        console.log('✅ [导出] 视频导出完成')
        unifiedStore.messageSuccess(t('editor.exportSuccess'))
      },
      // 失败回调
      (error: Error) => {
        console.error('导出项目失败:', error)
        // 显示错误通知
        loading.close()
        cancelExport = null
        unifiedStore.messageError(error.message || t('editor.exportFailed'))
      },
      // 取消回调
      () => {
        console.log('⚠️ [导出] 用户取消导出')
        loading.close()
        cancelExport = null
        unifiedStore.messageInfo(t('editor.exportCancelled'))
      }
    )
  } catch (error) {
    console.error('导出项目失败:', error)
    // 显示错误通知
    unifiedStore.messageError(error instanceof Error ? error.message : t('editor.exportFailed'))
  }
}

async function handleUserClick() {
  if (isUserLogin.value) {
    // 如果已登录，显示用户信息对话框
    showUserInfoDialog.value = true
  } else {
    // 如果未登录，显示登录对话框
    showLoginDialog.value = true
  }
}

function showEditProjectDialog() {
  showEditDialog.value = true
}

// 处理保存项目编辑
async function handleSaveProject(data: { name: string; description: string }) {
  try {
    // 更新 store 中的项目信息
    unifiedStore.projectName = data.name
    unifiedStore.projectDescription = data.description

    // 先关闭对话框，提升用户体验
    showEditDialog.value = false
    console.log('项目信息已更新:', data.name)

    // 异步保存项目配置（只保存元信息，不涉及timeline内容）
    unifiedStore
      .saveCurrentProject({ configChanged: true })
      .then(() => {
        console.log('项目配置保存成功:', data.name)
      })
      .catch((error) => {
        console.error('保存项目配置失败:', error)
        // 可以添加错误提示，但不影响对话框关闭
      })
  } catch (error) {
    console.error('更新项目信息失败:', error)
    // 可以添加错误提示
  }
}

// 键盘快捷键处理
function handleKeydown(event: KeyboardEvent) {
  // Ctrl+S 保存
  if (event.ctrlKey && event.key === 's') {
    event.preventDefault()
    saveProject()
  }

  // Ctrl+E 导出
  if (event.ctrlKey && event.key === 'e') {
    event.preventDefault()
    exportProject()
  }
}

// 生命周期
onMounted(() => {
  // 注册键盘快捷键
  window.addEventListener('keydown', handleKeydown)
})

onUnmounted(() => {
  // 清理键盘快捷键
  window.removeEventListener('keydown', handleKeydown)
})

// 暴露必要的方法给父组件（现在只需要 showEditProjectDialog）
defineExpose({
  showEditProjectDialog,
})
</script>

<style scoped>
.status-bar-container {
  padding: var(--spacing-sm) var(--spacing-sm) 0 var(--spacing-sm);
  flex-shrink: 0;
}

.status-bar {
  height: 30px;
  background-color: var(--color-bg-secondary);
  border-radius: var(--border-radius-medium);
  display: flex;
  align-items: center;
  flex-shrink: 0;
  padding: 0 var(--spacing-lg);
}

.status-content {
  display: flex;
  align-items: center;
  justify-content: space-between;
  width: 100%;
  position: relative; /* 为中间区域的绝对定位提供参考 */
}

.status-left {
  display: flex;
  align-items: center;
  gap: var(--spacing-sm);
  flex: 0 0 200px; /* 固定左侧宽度 */
}

.status-center {
  display: flex;
  align-items: center;
  justify-content: center;
  flex: 1;
  position: absolute;
  left: 50%;
  transform: translateX(-50%); /* 绝对居中 */
}

.status-right {
  display: flex;
  align-items: center;
  flex: 0 0 200px;
  justify-content: flex-end;
}

.button-group-left {
  display: flex;
  align-items: center;
  gap: var(--spacing-md);
}

.button-group-right {
  display: flex;
  align-items: center;
  margin-left: var(--spacing-xl); /* 增加左侧间距，让导出按钮更靠右 */
}

.project-title {
  font-size: var(--font-size-md);
  color: var(--color-text-primary);
  font-weight: 600;
}

.edit-icon {
  opacity: 0.6;
  transition: opacity 0.2s ease;
  color: var(--color-text-secondary);
}

.project-status {
  font-size: var(--font-size-xs);
  color: var(--color-text-muted);
}

.status-bar-container.loading-hidden {
  opacity: 0;
  pointer-events: none;
}

.login-text {
  font-size: var(--font-size-sm);
  color: var(--color-text-secondary);
  margin-left: var(--spacing-xs);
}

.bizyair-key-text {
  font-size: var(--font-size-xs);
  color: #ff4444;
  font-weight: 600;
  margin-left: 2px;
}
</style>
