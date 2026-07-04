import { ref, type Ref } from 'vue'
import type { ModuleRegistry } from './ModuleRegistry'
import type { CommonEffectType } from '@/core/effect-template/commonTypes'

export type PropertyTabKey = 'basic' | 'transition' | 'mask' | 'filter' | 'animation'
export type LibrarySectionKey = 'media' | 'transition' | 'filter'

/**
 * 统一 UI 模块
 * 负责管理应用内的 UI 状态
 */
export function createUnifiedUIModule(_registry: ModuleRegistry): {
  // 状态
  isChatPanelVisible: Ref<boolean>
  aiPanelActiveTab: Ref<'ai-generate' | 'agent' | 'frame-inspection'>
  librarySection: Ref<LibrarySectionKey>
  effectTemplateCategorySelection: Ref<Record<CommonEffectType, string>>
  activePropertyTab: Ref<PropertyTabKey>

  // AI 面板状态管理方法
  setChatPanelVisible: (visible: boolean) => void
  setLibrarySection: (section: LibrarySectionKey) => void
  setEffectTemplateCategory: (effectType: CommonEffectType, categoryKey: string) => void
  setActivePropertyTab: (tab: PropertyTabKey) => void
} {
  // ==================== 状态定义 ====================

  // AI 聊天面板可见性状态（默认显示）
  const isChatPanelVisible = ref(true)

  // AI 面板当前激活的标签页
  const aiPanelActiveTab = ref<'ai-generate' | 'agent' | 'frame-inspection'>('agent')

  // 素材区当前激活的一级分区
  const librarySection = ref<LibrarySectionKey>('media')
  const effectTemplateCategorySelection = ref<Record<CommonEffectType, string>>({
    transition: 'all',
    filter: 'all',
  })

  // 属性面板当前激活的标签页
  const activePropertyTab = ref<PropertyTabKey>('basic')

  // ==================== 状态管理方法 ====================

  /**
   * 设置 AI 聊天面板可见性
   */
  function setChatPanelVisible(visible: boolean): void {
    isChatPanelVisible.value = visible
  }

  function setLibrarySection(section: LibrarySectionKey): void {
    librarySection.value = section
  }

  function setEffectTemplateCategory(effectType: CommonEffectType, categoryKey: string): void {
    effectTemplateCategorySelection.value = {
      ...effectTemplateCategorySelection.value,
      [effectType]: categoryKey || 'all',
    }
  }

  function setActivePropertyTab(tab: PropertyTabKey): void {
    activePropertyTab.value = tab
  }

  return {
    // AI 面板状态
    isChatPanelVisible,
    aiPanelActiveTab,
    librarySection,
    effectTemplateCategorySelection,
    activePropertyTab,

    // AI 面板状态管理方法
    setChatPanelVisible,
    setLibrarySection,
    setEffectTemplateCategory,
    setActivePropertyTab,
  }
}

// 导出类型定义
export type UnifiedUIModule = ReturnType<typeof createUnifiedUIModule>
