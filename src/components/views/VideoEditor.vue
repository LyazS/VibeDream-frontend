<template>
  <div class="video-editor-view">
    <!-- 顶部栏组件 -->
    <EditorTopBar />

    <!-- 视频编辑器主体 -->
    <div
      class="editor-content"
      :class="{ 'loading-hidden': unifiedStore.showProjectLoadingProgress }"
    >
      <VideoPreviewEngine :isAIChatPanelVisible="unifiedStore.isChatPanelVisible" @update:isAIChatPanelVisible="unifiedStore.setChatPanelVisible" />
    </div>

    <TaskCenterPanel />

    <!-- 加载进度覆盖层 -->
    <LoadingOverlay
      :visible="unifiedStore.showProjectLoadingProgress"
      :title="t('editor.loading')"
      :stage="unifiedStore.projectLoadingStage"
      :progress="unifiedStore.projectLoadingProgress"
      :details="unifiedStore.projectLoadingDetails"
      :tipText="t('editor.loadTip')"
      :showTitle="true"
      :showStage="true"
      :showProgress="true"
      :showDetails="true"
      :showTips="true"
    />
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onBeforeMount, onMounted, onUnmounted } from 'vue'
import { useRoute } from 'vue-router'
import { useUnifiedStore } from '@/core/unifiedStore'
import VideoPreviewEngine from '@/components/panels/VideoPreviewEngine.vue'
import EditorTopBar from '@/components/panels/EditorTopBar.vue'
import TaskCenterPanel from '@/components/panels/TaskCenterPanel.vue'
import LoadingOverlay from '@/components/base/LoadingOverlay.vue'
import { useAppI18n } from '@/core/composables/useI18n'

const route = useRoute()
const unifiedStore = useUnifiedStore()
const { t } = useAppI18n()

// 键盘快捷键（兼容 Windows/Linux 的 Ctrl+B 和 Mac 的 Cmd+B 切换聊天面板）
function handleKeydown(event: KeyboardEvent) {
  // Ctrl+B (Windows/Linux) 或 Cmd+B (Mac) 切换聊天面板
  if ((event.ctrlKey || event.metaKey) && event.key === 'b') {
    event.preventDefault()
    unifiedStore.setChatPanelVisible(!unifiedStore.isChatPanelVisible)
  }
}

// 生命周期
// 预加载项目设置（在所有子组件挂载前完成，确保初始化时使用正确的分辨率）
onBeforeMount(async () => {
  console.log(' [LIFECYCLE] VideoEditor.onBeforeMount 开始')

  // 从路由参数获取项目ID
  const projectId = route.params.projectId as string
  if (!projectId) {
    console.error('❌ [LIFECYCLE] VideoEditor 缺少项目ID参数')
    // 返回根目录
    window.location.href = '/'
  }

  try {
    console.log(' [LIFECYCLE] VideoEditor 开始预加载项目设置')
    await unifiedStore.preloadProjectSettings(projectId)
    console.log('🔄 [LIFECYCLE] VideoEditor 项目设置预加载完成')
  } catch (error) {
    // 对于现有项目，预加载失败是严重错误，需要通知用户
    console.error('🔄 [LIFECYCLE] VideoEditor 预加载项目设置失败:', error)
    // 跳转到项目管理页面
    window.location.href = '/'
  }
  console.log('🔄 [LIFECYCLE] VideoEditor.onBeforeMount 完成')
})

onMounted(async () => {
  console.log(' [LIFECYCLE] VideoEditor.onMounted 开始')

  // 从路由参数获取项目ID
  const projectId = route.params.projectId as string
  if (!projectId) {
    console.error('❌ [LIFECYCLE] VideoEditor 缺少项目ID参数')
    // 返回根目录
    window.location.href = '/'
  }

  // 加载项目内容
  try {
    unifiedStore.disableAutoSave()
    console.log('📂 [VideoEditor] 开始加载项目内容...')
    await unifiedStore.loadProjectContent(projectId)

    console.log('✅ [VideoEditor] 项目内容加载完成:', unifiedStore.projectName)
    // 启用自动保存（模块化版本）
    unifiedStore.enableAutoSave()
    console.log('✅ [VideoEditor] 自动保存已启用')
  } catch (error) {
    console.error('❌ [VideoEditor] 加载项目内容失败:', error)
    // 跳转到项目管理页面
    window.location.href = '/'
  }

  // 注册键盘快捷键
  window.addEventListener('keydown', handleKeydown)
  console.log('🔄 [LIFECYCLE] VideoEditor.onMounted 完成')
})

onUnmounted(() => {
  // 禁用自动保存（模块化版本）
  unifiedStore.disableAutoSave()
  // 清理键盘快捷键
  window.removeEventListener('keydown', handleKeydown)
})
</script>

<style scoped>
.video-editor-view {
  width: 100%;
  height: 100vh;
  display: flex;
  flex-direction: column;
  background-color: var(--color-bg-primary);
  color: var(--color-text-primary);
}

.editor-content {
  flex: 1;
  overflow: hidden;
  transition: opacity 0.3s ease;
}

.editor-content.loading-hidden {
  opacity: 0;
  pointer-events: none;
}

.spinning {
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
</style>
