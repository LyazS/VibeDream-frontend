<template>
  <div class="media-grid" :class="{ 'drag-over': isDragOver }">
    <n-scrollbar
      @dragover="handleDragOver"
      @dragleave="handleDragLeave"
      @drop="handleDrop"
      @contextmenu="handleContextMenu"
      @click="handleContainerClick"
    >
      <!-- 空状态 -->
      <div v-if="displayItems.length === 0" class="empty-state">
        <component :is="IconComponents.FOLDER_OPEN" size="32px" />
        <p>{{ currentDir ? t('media.folderEmpty') : t('media.selectFolder') }}</p>
        <p class="hint">{{ t('media.dragOrImportHint') }}</p>
      </div>

      <!-- 内容项列表 - 图标视图 -->
      <div
        v-else-if="unifiedStore.viewMode !== 'list'"
        class="content-list"
        :class="`view-${unifiedStore.viewMode}`"
      >
        <div
          v-for="item in displayItems"
          :key="item.id"
          class="content-item"
          :class="{
            'directory-item': item.type === 'directory',
            'media-item': item.type === 'asset',
            selected: isItemSelected(item),
            'is-cut': isItemCut(item),
            'is-copy': isItemCopy(item),
            'drag-over-folder': item.type === 'directory' && folderDragState[item.id]?.isDragOver,
            'can-drop-folder': item.type === 'directory' && folderDragState[item.id]?.canDrop,
            'cannot-drop-folder':
              item.type === 'directory' &&
              folderDragState[item.id]?.isDragOver &&
              !folderDragState[item.id]?.canDrop,
          }"
        >
          <!-- 可拖拽和点击的图标区域 -->
          <div
            class="item-draggable-area"
            @dblclick="onItemDoubleClick(item)"
            @click="onItemClick(item, $event)"
            @contextmenu="onItemContextMenu(item, $event)"
            @dragstart="handleItemDragStart($event, item)"
            @dragend="handleItemDragEnd"
            @dragenter="item.type === 'directory' ? handleFolderDragEnter($event, item.id) : null"
            @dragover="item.type === 'directory' ? handleFolderDragOver($event, item.id) : null"
            @dragleave="item.type === 'directory' ? handleFolderDragLeave($event, item.id) : null"
            @drop="item.type === 'directory' ? handleFolderDrop($event, item.id) : null"
            :draggable="isDraggable(item)"
          >
            <!-- 文件夹项目 -->
            <template v-if="item.type === 'directory'">
              <div class="item-icon directory-icon">
                <FolderIcon :folder-id="item.id" :size="getIconSize()" :is-list-view="false" />
              </div>
            </template>

            <!-- 资产项目 -->
            <template v-else>
              <div
                class="item-icon media-icon"
                :class="{ 'template-icon': isEffectTemplateAssetItem(item.id) }"
              >
                <template v-if="isEffectTemplateAssetItem(item.id)">
                  <div class="effect-template-thumbnail">
                    <component :is="IconComponents.SPARKLING" size="28px" />
                    <span class="effect-template-tag">转场</span>
                    <span class="effect-template-summary">{{ getEffectTemplateSummary(item.id) }}</span>
                  </div>
                </template>
                <template v-else>
                  <MediaItemThumbnail :media-id="item.id" />
                </template>
              </div>
            </template>
          </div>

          <!-- 文件名区域（不可拖拽） -->
          <div class="item-name">
            {{
              item.type === 'directory'
                ? getDirectory(item.id)?.name || ''
                : getAsset(item.id)?.name || ''
            }}
          </div>
        </div>
      </div>

      <!-- 内容项列表 - 列表视图 -->
      <div v-else class="content-list-view">
        <div
          v-for="item in displayItems"
          :key="item.id"
          class="list-item"
          :class="{
            'directory-item': item.type === 'directory',
            'media-item': item.type === 'asset',
            selected: isItemSelected(item),
            'is-cut': isItemCut(item),
            'is-copy': isItemCopy(item),
            'drag-over-folder': item.type === 'directory' && folderDragState[item.id]?.isDragOver,
            'can-drop-folder': item.type === 'directory' && folderDragState[item.id]?.canDrop,
            'cannot-drop-folder':
              item.type === 'directory' &&
              folderDragState[item.id]?.isDragOver &&
              !folderDragState[item.id]?.canDrop,
          }"
          @dblclick="onItemDoubleClick(item)"
          @click="onItemClick(item, $event)"
          @contextmenu="onItemContextMenu(item, $event)"
          @dragstart="handleItemDragStart($event, item)"
          @dragend="handleItemDragEnd"
          @dragenter="item.type === 'directory' ? handleFolderDragEnter($event, item.id) : null"
          @dragover="item.type === 'directory' ? handleFolderDragOver($event, item.id) : null"
          @dragleave="item.type === 'directory' ? handleFolderDragLeave($event, item.id) : null"
          @drop="item.type === 'directory' ? handleFolderDrop($event, item.id) : null"
          :draggable="isDraggable(item)"
        >
          <!-- 图标列 -->
          <div class="list-item-icon">
            <template v-if="item.type === 'directory'">
              <FolderIcon :folder-id="item.id" size="20px" :is-list-view="true" />
            </template>
            <template v-else>
              <template v-if="isEffectTemplateAssetItem(item.id)">
                <div class="effect-template-list-icon">
                  <component :is="IconComponents.SPARKLING" size="18px" />
                </div>
              </template>
              <template v-else>
                <MediaItemThumbnail :media-id="item.id" />
              </template>
            </template>
          </div>

          <!-- 名称列 -->
          <div class="list-item-name">
            {{
              item.type === 'directory'
                ? getDirectory(item.id)?.name || ''
                : getAsset(item.id)?.name || ''
            }}
          </div>

          <!-- 类型列 -->
          <div class="list-item-type">
            {{ item.type === 'directory' ? t('media.folder') : getAssetTypeLabel(item.id) }}
          </div>
        </div>
      </div>

      <!-- 右键菜单 -->
      <ContextMenu v-model:show="showContextMenu" :options="contextMenuOptions">
        <template v-for="(item, index) in currentMenuItems" :key="index">
          <ContextMenuSeparator v-if="'type' in item && item.type === 'separator'" />
          <ContextMenuItem
            v-else-if="'label' in item && 'onClick' in item && !('children' in item)"
            :label="item.label"
            :disabled="item.disabled"
            @click="item.onClick"
          >
            <template #icon>
              <component
                :is="item.icon"
                size="16px"
                :style="{ color: item.icon === IconComponents.DELETE ? '#ff6b6b' : undefined }"
              />
            </template>
          </ContextMenuItem>
          <ContextMenuGroup v-else-if="'label' in item && 'children' in item" :label="item.label">
            <template #icon>
              <component :is="item.icon" size="16px" />
            </template>
            <template v-for="(childItem, childIndex) in item.children" :key="childIndex">
              <ContextMenuSeparator v-if="'type' in childItem && childItem.type === 'separator'" />
              <ContextMenuItem
                v-else-if="'label' in childItem"
                :label="childItem.label"
                :disabled="childItem.disabled"
                @click="childItem.onClick"
              >
                <template #icon>
                  <component
                    :is="childItem.icon"
                    size="16px"
                    :style="{
                      color: childItem.icon === IconComponents.DELETE ? '#ff6b6b' : undefined,
                    }"
                  />
                </template>
              </ContextMenuItem>
            </template>
          </ContextMenuGroup>
        </template>
      </ContextMenu>

      <!-- 创建文件夹对话框 -->
      <CreateFolderModal
        :show="showCreateDirModal"
        @close="showCreateDirModal = false"
        @confirm="handleCreateFolder"
      />

      <!-- 重命名对话框 -->
      <RenameModal
        :show="showRenameModal"
        :current-name="renameCurrentName"
        @close="handleRenameClose"
        @confirm="handleRenameConfirm"
      />

      <!-- 媒体预览模态框 -->
      <MediaPreviewModal
        :show="showMediaPreviewModal"
        :media-item-id="previewMediaItemId"
        @update:show="showMediaPreviewModal = $event"
        @close="showMediaPreviewModal = false"
      />

      <!-- 隐藏的文件输入 -->
      <input
        ref="fileInput"
        type="file"
        multiple
        accept="video/*,image/*,audio/*"
        style="display: none"
        @change="handleFileSelect"
      />

    </n-scrollbar>
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue'
import { NScrollbar } from 'naive-ui'
import { useAppI18n } from '@/core/composables/useI18n'
import { useUnifiedStore } from '@/core/unifiedStore'
import type { DisplayItem, VirtualDirectory, ClipboardItem, SortBy } from '@/core/directory/types'
import {
  DragSourceType,
  DropTargetType,
  type AssetDragParams,
  type FolderDragParams,
  type DropTargetInfo,
} from '@/core/types/drag'
import type { UnifiedMediaItemData } from '@/core'
import { DataSourceFactory } from '@/core'
import { generateAssetId, generateMediaId, extractExtension } from '@/core/utils/idGenerator'
import {
  AIGenerationSourceFactory,
  TaskStatus,
  ContentType,
  AITaskType,
  type MediaGenerationRequest,
  type AIGenerationSourceData,
} from '@/core/datasource/providers/ai-generation/AIGenerationSource'
import { SourceOrigin } from '@/core/datasource/core/BaseDataSource'
import { fetchClient } from '@/utils/fetchClient'
import { IconComponents } from '@/constants/iconComponents'
import {
  ContextMenu,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuGroup,
} from '@imengyu/vue3-context-menu'
import CreateFolderModal from '@/components/modals/CreateFolderModal.vue'
import RenameModal from '@/components/modals/RenameModal.vue'
import MediaItemThumbnail from '@/components/panels/MediaItemThumbnail.vue'
import MediaPreviewModal from '@/components/modals/MediaPreviewModal.vue'
import FolderIcon from '@/components/utils/FolderIcon.vue'
import type { TaskSubmitResponse } from '@/types/taskApi'
import { TaskSubmitErrorCode } from '@/types/taskApi'
import {
  buildTaskErrorMessage,
  shouldShowRechargePrompt,
  isRetryableError,
} from '@/utils/errorMessageBuilder'
import type { UnifiedLibraryAssetData } from '@/core/asset/types'
import {
  createTransitionTemplateAssetData,
  isEffectTemplateAsset,
  isMediaAsset,
} from '@/core/asset/types'
import COPY_VERTEX_SHADER from '@/core/webgl2/shaders/copy.vert?raw'

const unifiedStore = useUnifiedStore()
const { t } = useAppI18n()

// 检查是否为外部文件拖拽（区分内部项目拖拽）
function isFileDrag(event: DragEvent): boolean {
  const types = event.dataTransfer?.types || []

  // 如果包含内部拖拽标记，则不是外部文件拖拽
  if (types.includes('application/x-unified-drag')) {
    return false
  }

  // 只有 Files 类型且没有内部拖拽标记，才是外部文件拖拽
  return types.includes('Files')
}

// 组件状态
const isDragOver = ref(false)
const fileInput = ref<HTMLInputElement>()
const showCreateDirModal = ref(false)

// 重命名状态
const showRenameModal = ref(false)
const renameCurrentName = ref('')
const renameTarget = ref<DisplayItem | null>(null)

// 预览模态框状态
const showMediaPreviewModal = ref(false)
const previewMediaItemId = ref<string>('')


// 文件夹拖拽状态（每个文件夹独立状态）
const folderDragState = ref<Record<string, { isDragOver: boolean; canDrop: boolean }>>({})

// 右键菜单状态
const showContextMenu = ref(false)
const contextMenuTarget = ref<DisplayItem | null>(null)
const contextMenuOptions = ref({
  x: 0,
  y: 0,
  theme: 'mac dark',
  zIndex: 1000,
})

// 菜单项类型定义
type MenuItem =
  | {
      label: string
      icon: any // 图标组件
      onClick?: () => void
      disabled?: boolean
      children?: MenuItem[]
    }
  | {
      type: 'separator'
    }

// 从 store 获取状态
const currentDir = computed(() => unifiedStore.currentDir)

// 剪贴板状态
const clipboardState = computed(() => unifiedStore.clipboardState)
const isClipboardEmpty = computed(() => clipboardState.value.items.length === 0)
const canPasteHere = computed(() => {
  if (!currentDir.value) return false
  return unifiedStore.canPaste(currentDir.value.id)
})

// 在组件内部计算剪切和复制项ID列表
const cutItemIds = computed(() => {
  if (clipboardState.value.operation === 'cut') {
    return clipboardState.value.items.map((item: ClipboardItem) => item.id)
  }
  return []
})

const copyItemIds = computed(() => {
  if (clipboardState.value.operation === 'copy') {
    return clipboardState.value.items.map((item: ClipboardItem) => item.id)
  }
  return []
})

// 检查项目是否被剪切
function isItemCut(item: DisplayItem): boolean {
  return cutItemIds.value.includes(item.id)
}

// 检查项目是否被复制
function isItemCopy(item: DisplayItem): boolean {
  return copyItemIds.value.includes(item.id)
}

// 当前目录的显示项列表（带排序）
const displayItems = computed(() => {
  if (!currentDir.value) return []
  const items = unifiedStore.getDirectoryContent(currentDir.value.id)
  return sortItems(items)
})

// 排序函数
function sortItems(items: DisplayItem[]): DisplayItem[] {
  const sorted = [...items]

  sorted.sort((a, b) => {
    // 文件夹始终排在前面
    if (a.type === 'directory' && b.type !== 'directory') return -1
    if (a.type !== 'directory' && b.type === 'directory') return 1

    let comparison = 0

    switch (unifiedStore.sortBy) {
      case 'name': {
        const nameA =
          a.type === 'directory'
            ? (getDirectory(a.id)?.name || '').toLowerCase()
            : (getAsset(a.id)?.name || '').toLowerCase()
        const nameB =
          b.type === 'directory'
            ? (getDirectory(b.id)?.name || '').toLowerCase()
            : (getAsset(b.id)?.name || '').toLowerCase()
        comparison = nameA.localeCompare(nameB, 'zh-CN')
        break
      }

      case 'date': {
        const dateA =
          a.type === 'directory'
            ? getDirectory(a.id)?.createdAt || ''
            : getAsset(a.id)?.createdAt || ''
        const dateB =
          b.type === 'directory'
            ? getDirectory(b.id)?.createdAt || ''
            : getAsset(b.id)?.createdAt || ''
        comparison = dateA.localeCompare(dateB)
        break
      }

      case 'type': {
        if (a.type === 'directory' && b.type === 'directory') {
          // 两个都是文件夹，按名称排序
          const nameA = (getDirectory(a.id)?.name || '').toLowerCase()
          const nameB = (getDirectory(b.id)?.name || '').toLowerCase()
          comparison = nameA.localeCompare(nameB, 'zh-CN')
        } else if (a.type === 'asset' && b.type === 'asset') {
          const typeA = getAssetSortKey(a.id)
          const typeB = getAssetSortKey(b.id)
          comparison = typeA.localeCompare(typeB)
          // 如果类型相同，按名称排序
          if (comparison === 0) {
            const nameA = (getAsset(a.id)?.name || '').toLowerCase()
            const nameB = (getAsset(b.id)?.name || '').toLowerCase()
            comparison = nameA.localeCompare(nameB, 'zh-CN')
          }
        }
        break
      }
    }

    // 应用排序顺序
    return unifiedStore.sortOrder === 'asc' ? comparison : -comparison
  })

  return sorted
}

// 设置排序方式
function setSortBy(newSortBy: SortBy): void {
  unifiedStore.setSortBy(newSortBy)
  showContextMenu.value = false
}

// 动态菜单项配置
const currentMenuItems = computed((): MenuItem[] => {
  if (!contextMenuTarget.value) {
    // 空白区域菜单
    return [
      // 新建子菜单
      {
        label: t('media.new'),
        icon: IconComponents.ADD_CIRCLE,
        children: [
          {
            label: t('media.folder'),
            icon: IconComponents.FOLDER_ADD,
            onClick: () => {
              showCreateDirModal.value = true
              showContextMenu.value = false
            },
          },
          // 🆕 新增：创建角色
          {
            label: t('media.character.character'),
            icon: IconComponents.USER,
            onClick: () => {
              // 检查是否选择了目录
              if (!currentDir.value) {
                unifiedStore.messageError(t('media.selectDirectoryFirst'))
                return
              }

              // 打开角色编辑器（创建模式）
              unifiedStore.openCharacterEditor('create')
              // 打开 AI 面板
              unifiedStore.setChatPanelVisible(true)
              showContextMenu.value = false
            },
          },
          {
            label: t('media.importFiles'),
            icon: IconComponents.UPLOAD,
            onClick: () => {
              triggerFileInput()
              showContextMenu.value = false
            },
          },
          {
            label: '转场（测试）',
            icon: IconComponents.SPARKLING,
            onClick: () => {
              void createTransitionTemplateAsset()
              showContextMenu.value = false
            },
          },
          {
            label: t('media.pasteImport'),
            icon: IconComponents.CLIPBOARD,
            onClick: handlePasteFromClipboard,
          },
        ],
      },
      // 查看子菜单
      {
        label: t('media.view'),
        icon: IconComponents.VISIBLE,
        children: [
          {
            label:
              unifiedStore.viewMode === 'large-icon'
                ? `✓ ${t('media.largeIcon')}`
                : t('media.largeIcon'),
            icon: IconComponents.IMAGE_LARGE,
            onClick: () => {
              unifiedStore.setViewMode('large-icon')
              showContextMenu.value = false
            },
          },
          {
            label:
              unifiedStore.viewMode === 'medium-icon'
                ? `✓ ${t('media.mediumIcon')}`
                : t('media.mediumIcon'),
            icon: IconComponents.IMAGE_LARGE,
            onClick: () => {
              unifiedStore.setViewMode('medium-icon')
              showContextMenu.value = false
            },
          },
          {
            label:
              unifiedStore.viewMode === 'small-icon'
                ? `✓ ${t('media.smallIcon')}`
                : t('media.smallIcon'),
            icon: IconComponents.IMAGE_LARGE,
            onClick: () => {
              unifiedStore.setViewMode('small-icon')
              showContextMenu.value = false
            },
          },
          {
            label: unifiedStore.viewMode === 'list' ? `✓ ${t('media.list')}` : t('media.list'),
            icon: IconComponents.LIST,
            onClick: () => {
              unifiedStore.setViewMode('list')
              showContextMenu.value = false
            },
          },
        ],
      },
      // 排序方式子菜单
      {
        label: t('media.sortBy'),
        icon: unifiedStore.sortOrder === 'asc' ? IconComponents.SORT_ASC : IconComponents.SORT_DESC,
        children: [
          {
            label:
              unifiedStore.sortBy === 'name'
                ? `✓ ${t('media.name')} ${unifiedStore.sortOrder === 'asc' ? '↑' : '↓'}`
                : t('media.name'),
            icon: IconComponents.TEXT_LINE,
            onClick: () => setSortBy('name'),
          },
          {
            label:
              unifiedStore.sortBy === 'date'
                ? `✓ ${t('media.dateModified')} ${unifiedStore.sortOrder === 'asc' ? '↑' : '↓'}`
                : t('media.dateModified'),
            icon: IconComponents.CALENDAR,
            onClick: () => setSortBy('date'),
          },
          {
            label:
              unifiedStore.sortBy === 'type'
                ? `✓ ${t('media.type')} ${unifiedStore.sortOrder === 'asc' ? '↑' : '↓'}`
                : t('media.type'),
            icon: IconComponents.FOLDER_3,
            onClick: () => setSortBy('type'),
          },
        ],
      },
      { type: 'separator' },
      {
        label: t('media.paste'),
        icon: IconComponents.CLIPBOARD,
        onClick: handlePaste,
        disabled: !canPasteHere.value,
      },
      {
        label: t('media.clearClipboard'),
        icon: IconComponents.CLEAR,
        onClick: handleClearClipboard,
        disabled: isClipboardEmpty.value,
      },
    ]
  }

  // 检查是否为多选状态
  if (unifiedStore.selectedMediaItemIds.size > 1) {
    // 多选状态菜单
    return [
      {
        label: t('media.cut'),
        icon: IconComponents.CUT,
        onClick: handleCut,
      },
      {
        label: t('media.copy'),
        icon: IconComponents.COPY,
        onClick: handleCopy,
      },
      { type: 'separator' },
      {
        label: t('media.delete'),
        icon: IconComponents.DELETE,
        onClick: handleBatchDelete,
      },
    ]
  }

  const target = contextMenuTarget.value
  if (target.type === 'directory') {
    // 文件夹菜单
    return [
      {
        label: t('media.open'),
        icon: IconComponents.FOLDER_OPEN,
        onClick: () => {
          unifiedStore.navigateToDir(target.id)
          showContextMenu.value = false
        },
      },
      { type: 'separator' },
      {
        label: t('media.cut'),
        icon: IconComponents.CUT,
        onClick: handleCut,
      },
      {
        label: t('media.copy'),
        icon: IconComponents.COPY,
        onClick: handleCopy,
      },
      {
        label: t('media.paste'),
        icon: IconComponents.CLIPBOARD,
        onClick: () => handlePasteToFolder(target.id),
        disabled: !unifiedStore.canPaste(target.id),
      },
      { type: 'separator' },
      {
        label: t('media.rename'),
        icon: IconComponents.EDIT,
        onClick: () => {
          startRename(target)
          showContextMenu.value = false
        },
      },
      { type: 'separator' },
      {
        label: t('media.delete'),
        icon: IconComponents.DELETE,
        onClick: () => {
          deleteFolder(target.id)
          showContextMenu.value = false
        },
      },
    ]
  } else {
    // 资产菜单
    return [
      {
        label: t('media.cut'),
        icon: IconComponents.CUT,
        onClick: handleCut,
      },
      {
        label: t('media.copy'),
        icon: IconComponents.COPY,
        onClick: handleCopy,
      },
      { type: 'separator' },
      {
        label: t('media.rename'),
        icon: IconComponents.EDIT,
        onClick: () => {
          startRename(target)
          showContextMenu.value = false
        },
      },
      ...(isMediaAsset(getAsset(target.id))
        ? ([
            { type: 'separator' as const },
            {
              label: t('media.cancel'),
              icon: IconComponents.CLOSE,
              onClick: handleCancelTask,
              disabled: !canCancel(target),
            },
            {
              label: t('media.retry'),
              icon: IconComponents.REFRESH,
              onClick: handleRetry,
              disabled: !canRetry(target),
            },
          ] satisfies MenuItem[])
        : []),
      { type: 'separator' },
      {
        label: t('media.delete'),
        icon: IconComponents.DELETE,
        onClick: () => {
          removeAssetItem(target.id)
          showContextMenu.value = false
        },
      },
    ]
  }
})

// ==================== 核心方法 ====================

// 获取目录
function getDirectory(id: string): VirtualDirectory | undefined {
  return unifiedStore.getDirectory(id)
}

function getMediaItem(id: string): UnifiedMediaItemData | undefined {
  return unifiedStore.getMediaItem(id)
}

function getAsset(id: string): UnifiedLibraryAssetData | undefined {
  return unifiedStore.getAsset(id)
}

// 获取图标大小（返回像素值）
function getIconSize() {
  switch (unifiedStore.viewMode) {
    case 'large-icon':
      return '96px'
    case 'medium-icon':
      return '64px'
    case 'small-icon':
      return '48px'
    default:
      return '48px'
  }
}

function getAssetTypeLabel(assetId: string): string {
  const asset = getAsset(assetId)
  if (!asset) return t('media.unknown')

  if (isEffectTemplateAsset(asset)) {
    return asset.effectType === 'transition' ? '转场' : asset.effectType
  }

  switch (asset.mediaType) {
    case 'video':
      return t('media.video')
    case 'audio':
      return t('media.audio')
    case 'image':
      return t('media.image')
    default:
      return t('media.unknown')
  }
}

function getAssetSortKey(assetId: string): string {
  const asset = getAsset(assetId)
  if (!asset) return 'unknown'
  return isEffectTemplateAsset(asset) ? `effect-${asset.effectType}` : `media-${asset.mediaType}`
}

function isEffectTemplateAssetItem(assetId: string): boolean {
  return isEffectTemplateAsset(getAsset(assetId))
}

function getEffectTemplateSummary(assetId: string): string {
  const asset = getAsset(assetId)
  if (!asset || !isEffectTemplateAsset(asset) || asset.effectType !== 'transition') {
    return ''
  }

  const payload = asset.templatePayload as { durationFrames?: number }
  return `转场 / ${payload.durationFrames || 0}f`
}

// 检查媒体项是否可拖拽
function isMediaItemDraggable(mediaId: string): boolean {
  const mediaItem = getAsset(mediaId)
  if (!mediaItem) return false
  if (isEffectTemplateAsset(mediaItem)) return true
  return mediaItem.mediaType !== 'unknown' && (mediaItem.duration || 0) > 0
}

// 检查项目是否可拖拽（统一方法）
function isDraggable(item: DisplayItem): boolean {
  if (item.type === 'directory') {
    // 文件夹始终可拖拽
    return true
  } else {
    // 媒体项需要检查状态
    return isMediaItemDraggable(item.id)
  }
}

// 检查项目是否被选中
function isItemSelected(item: DisplayItem): boolean {
  return unifiedStore.isMediaItemSelected(item.id)
}

// ==================== 交互处理 ====================

// 双击项目处理
function onItemDoubleClick(item: DisplayItem): void {
  if (item.type === 'directory') {
    const dir = unifiedStore.getDirectory(item.id)
    
    // 判断是否为角色文件夹
    if (dir && unifiedStore.isCharacterDirectory(dir)) {
      unifiedStore.openCharacterEditor('edit', item.id)  // 打开角色编辑器
    } else {
      unifiedStore.navigateToDir(item.id)  // 普通文件夹导航
    }
  } else {
    const asset = getAsset(item.id)
    if (!asset) {
      unifiedStore.messageError(t('media.mediaNotFound'))
      return
    }

    if (isEffectTemplateAsset(asset)) {
      return
    }

    // 只有ready状态的媒体才能预览
    if (asset.mediaStatus !== 'ready') {
      unifiedStore.messageWarning(t('media.previewNotReady', { name: asset.name }))
      return
    }

    // 打开媒体预览
    previewMediaItemId.value = item.id
    showMediaPreviewModal.value = true
  }
}

// 单击项目处理
function onItemClick(item: DisplayItem, event: MouseEvent): void {
  if (event.ctrlKey || event.metaKey) {
    // Ctrl+点击：切换选择状态
    unifiedStore.selectMediaItems([item.id], 'toggle')
  } else if (event.shiftKey) {
    // Shift+点击：范围选择
    unifiedStore.selectMediaItems([item.id], 'range')
  } else {
    // 普通点击：单选
    unifiedStore.selectMediaItems([item.id], 'replace')
  }
}

// 项目右键菜单
function onItemContextMenu(item: DisplayItem, event: MouseEvent): void {
  event.preventDefault()
  event.stopPropagation()

  // 如果右键的项目不在选中列表中，则将其设为唯一选中项
  if (!isItemSelected(item)) {
    unifiedStore.selectMediaItems([item.id], 'replace')
  }

  contextMenuOptions.value.x = event.clientX
  contextMenuOptions.value.y = event.clientY
  contextMenuTarget.value = item
  showContextMenu.value = true
}

// 右键菜单处理
function handleContextMenu(event: MouseEvent): void {
  event.preventDefault()

  contextMenuOptions.value.x = event.clientX
  contextMenuOptions.value.y = event.clientY
  contextMenuTarget.value = null
  showContextMenu.value = true
}

// 点击空白区域
function handleContainerClick(event: MouseEvent): void {
  if (!event.target || !(event.target as Element).closest('.content-item')) {
    unifiedStore.clearMediaSelection()
  }
}

// ==================== 拖拽处理 ====================

// 拖拽开始（使用新的统一拖拽架构）
function handleItemDragStart(event: DragEvent, item: DisplayItem): void {
  // 根据项目类型选择不同的处理器
  if (item.type === 'asset') {
    handleMediaItemDrag(event, item)
  } else if (item.type === 'directory') {
    handleFolderDrag(event, item)
  }
}

// 处理媒体项拖拽
function handleMediaItemDrag(event: DragEvent, item: DisplayItem): void {
  const asset = getAsset(item.id)
  if (!asset) return

  // 获取源处理器
  const sourceHandler = unifiedStore.getSourceHandler(DragSourceType.ASSET)
  if (!sourceHandler) {
    console.warn('⚠️ [LibraryMediaGrid] 未找到 MediaItem 源处理器')
    return
  }

  // 准备拖拽参数
  const params: AssetDragParams = {
    assetId: item.id,
  }

  try {
    // 创建拖拽数据
    const dragData = sourceHandler.createDragData(event.currentTarget as HTMLElement, event, params)

    // 开始拖拽
    unifiedStore.startDrag(event, dragData)

    console.log('🎯 [LibraryMediaGrid] 素材项拖拽开始 - 完整拖拽数据:', dragData)
  } catch (error) {
    console.error('❌ [LibraryMediaGrid] 素材项拖拽启动失败:', error)
  }
}

// 处理文件夹拖拽
function handleFolderDrag(event: DragEvent, item: DisplayItem): void {
  const folder = getDirectory(item.id)
  if (!folder) return

  // 获取源处理器
  const sourceHandler = unifiedStore.getSourceHandler(DragSourceType.FOLDER)
  if (!sourceHandler) {
    console.warn('⚠️ [LibraryMediaGrid] 未找到 Folder 源处理器')
    return
  }

  // 准备拖拽参数
  const params: FolderDragParams = {
    folderId: item.id,
  }

  try {
    // 创建拖拽数据
    const dragData = sourceHandler.createDragData(event.currentTarget as HTMLElement, event, params)

    // 开始拖拽
    unifiedStore.startDrag(event, dragData)

    console.log('🎯 [LibraryMediaGrid] 文件夹拖拽开始 - 完整拖拽数据:', dragData)
  } catch (error) {
    console.error('❌ [LibraryMediaGrid] 文件夹拖拽启动失败:', error)
  }
}

// 拖拽结束
function handleItemDragEnd(): void {
  unifiedStore.endDrag()
  // 清空所有文件夹的拖拽状态
  folderDragState.value = {}
  console.log('🏁 [LibraryMediaGrid] 拖拽结束')
}

// ==================== 文件夹作为拖拽目标 ====================

// 文件夹拖拽进入
function handleFolderDragEnter(event: DragEvent, folderId: string): void {
  event.preventDefault()
  event.stopPropagation()

  // 初始化状态
  if (!folderDragState.value[folderId]) {
    folderDragState.value[folderId] = { isDragOver: false, canDrop: false }
  }

  folderDragState.value[folderId].isDragOver = true
}

// 文件夹拖拽悬停
function handleFolderDragOver(event: DragEvent, folderId: string): void {
  event.preventDefault()
  event.stopPropagation()

  // 创建目标信息
  const targetInfo: DropTargetInfo = {
    targetType: DropTargetType.FOLDER,
    targetId: folderId,
  }

  // 调用管理器判断是否允许放置
  const allowed = unifiedStore.handleDragOver(event, targetInfo)

  // 更新状态
  if (!folderDragState.value[folderId]) {
    folderDragState.value[folderId] = { isDragOver: true, canDrop: false }
  }
  folderDragState.value[folderId].canDrop = allowed
}

// 文件夹拖拽离开
function handleFolderDragLeave(event: DragEvent, folderId: string): void {
  event.stopPropagation()

  // 检查是否真的离开了元素（避免子元素触发）
  const currentTarget = event.currentTarget as Element
  const relatedTarget = event.relatedTarget as Node

  if (currentTarget && !currentTarget.contains(relatedTarget)) {
    // 重置状态
    if (folderDragState.value[folderId]) {
      folderDragState.value[folderId].isDragOver = false
      folderDragState.value[folderId].canDrop = false
    }
  }
}

// 文件夹拖拽放置
async function handleFolderDrop(event: DragEvent, folderId: string): Promise<void> {
  event.preventDefault()
  event.stopPropagation()
  isDragOver.value = false

  // 重置状态
  if (folderDragState.value[folderId]) {
    folderDragState.value[folderId].isDragOver = false
    folderDragState.value[folderId].canDrop = false
  }

  // 创建目标信息
  const targetInfo: DropTargetInfo = {
    targetType: DropTargetType.FOLDER,
    targetId: folderId,
  }

  // 调用管理器处理放置
  const result = await unifiedStore.handleDrop(event, targetInfo)

  if (result.success) {
    console.log('✅ [LibraryMediaGrid] 拖拽到文件夹成功:', folderId)
    unifiedStore.messageSuccess('移动成功')
  } else {
    console.error('❌ [LibraryMediaGrid] 拖拽到文件夹失败:', folderId)
    unifiedStore.messageError('移动失败')
  }
}

// 拖拽悬停
function handleDragOver(event: DragEvent): void {
  event.preventDefault()

  if (isFileDrag(event)) {
    event.dataTransfer!.dropEffect = 'copy'
    isDragOver.value = true
  } else {
    event.dataTransfer!.dropEffect = 'none'
    isDragOver.value = false
  }
}

// 拖拽离开
function handleDragLeave(event: DragEvent): void {
  const currentTarget = event.currentTarget as Element
  const relatedTarget = event.relatedTarget as Node
  if (currentTarget && !currentTarget.contains(relatedTarget)) {
    isDragOver.value = false
  }
}

// 拖拽放置
function handleDrop(event: DragEvent): void {
  event.preventDefault()
  isDragOver.value = false

  if (isFileDrag(event)) {
    const files = Array.from(event.dataTransfer?.files || [])
    if (files.length > 0) {
      processFiles(files)
    }
  }
}

// ==================== 文件夹操作 ====================

// 开始重命名
function startRename(item: DisplayItem): void {
  renameTarget.value = item

  if (item.type === 'directory') {
    const dir = getDirectory(item.id)
    renameCurrentName.value = dir?.name || ''
  } else {
    const asset = getAsset(item.id)
    renameCurrentName.value = asset?.name || ''
  }

  showRenameModal.value = true
}

// 处理重命名关闭
function handleRenameClose(): void {
  showRenameModal.value = false
  renameTarget.value = null
  renameCurrentName.value = ''
}

// 处理重命名确认
async function handleRenameConfirm(newName: string): Promise<void> {
  if (!renameTarget.value) {
    return
  }

  const target = renameTarget.value

  try {
    if (target.type === 'directory') {
      // 重命名文件夹
      const success = unifiedStore.renameDirectory(target.id, newName)
      if (success) {
        unifiedStore.messageSuccess(t('media.folderRenameSuccess'))
      } else {
        unifiedStore.messageError(t('media.folderRenameFailed'))
      }
    } else {
      unifiedStore.updateAssetName(target.id, newName)
      unifiedStore.messageSuccess(t('media.mediaRenameSuccess'))
    }

    handleRenameClose()
  } catch (error) {
    console.error('重命名失败:', error)
    unifiedStore.messageError(t('media.renameFailed'))
  }
}

// 处理创建文件夹
async function handleCreateFolder(folderName: string): Promise<void> {
  if (!currentDir.value) {
    unifiedStore.messageError(t('media.selectDirectoryFirst'))
    return
  }

  try {
    unifiedStore.createDirectory(folderName, currentDir.value.id)
    showCreateDirModal.value = false
    unifiedStore.messageSuccess(t('media.folderCreateSuccess'))
  } catch (error) {
    console.error('创建文件夹失败:', error)
    unifiedStore.messageError(t('media.folderCreateFailed'))
  }
}

// ==================== 文件导入 ====================

// 触发文件选择
function triggerFileInput(): void {
  fileInput.value?.click()
}

// 处理文件选择
function handleFileSelect(event: Event): void {
  const target = event.target as HTMLInputElement
  const files = Array.from(target.files || [])
  processFiles(files)
  target.value = ''
}

// 处理文件
async function processFiles(files: File[]): Promise<void> {
  if (!currentDir.value) {
    unifiedStore.messageError(t('media.selectDirectoryFirst'))
    return
  }

  console.log(`📁 开始处理 ${files.length} 个文件`)

  const results = await Promise.allSettled(files.map((file) => addMediaItem(file)))

  const successful = results.filter((result) => result.status === 'fulfilled').length
  const failed = results.filter((result) => result.status === 'rejected').length

  if (successful === 0 && failed > 0) {
    unifiedStore.messageError(t('media.allFilesProcessFailed'))
    return
  }

  console.log(t('media.fileProcessComplete', { success: successful, failed: failed }))
}

// 从系统剪贴板粘贴图片
async function handlePasteFromClipboard(): Promise<void> {
  if (!currentDir.value) {
    unifiedStore.messageError(t('media.selectDirectoryFirst'))
    return
  }

  showContextMenu.value = false

  try {
    // 检查浏览器是否支持 Clipboard API
    if (!navigator.clipboard || !navigator.clipboard.read) {
      unifiedStore.messageError(t('media.pasteImportNotSupported'))
      return
    }

    // 读取剪贴板内容
    const clipboardItems = await navigator.clipboard.read()
    const imageFiles: File[] = []

    // 遍历剪贴板项目
    for (const item of clipboardItems) {
      // 查找图片类型
      const imageType = item.types.find(type => type.startsWith('image/'))

      if (imageType) {
        // 获取图片 Blob
        const blob = await item.getType(imageType)

        // 生成文件名
        const timestamp = Date.now()
        const extension = imageType.split('/')[1] || 'png'
        const fileName = `Clipboard_Image_${timestamp}.${extension}`

        // 将 Blob 转换为 File
        const file = new File([blob], fileName, { type: imageType })
        imageFiles.push(file)
      }
    }

    // 检查是否找到图片
    if (imageFiles.length === 0) {
      unifiedStore.messageWarning(t('media.pasteImportNoImage'))
      return
    }

    // 处理图片文件
    await processFiles(imageFiles)
    unifiedStore.messageSuccess(t('media.pasteImportSuccess', { count: imageFiles.length }))

  } catch (error) {
    console.error('从剪贴板粘贴图片失败:', error)
    unifiedStore.messageError(
      t('media.pasteImportFailed', {
        error: error instanceof Error ? error.message : '未知错误'
      })
    )
  }
}


// 添加媒体项
async function addMediaItem(file: File): Promise<void> {
  if (!currentDir.value) return

  try {
    // 创建用户选择文件数据源
    const userSelectedSource = DataSourceFactory.createUserSelectedSourceFromFile(file)

    // 生成媒体ID
    const extension = extractExtension(file.name)
    const mediaId = generateMediaId(extension)

    // 创建统一媒体项目
    const mediaItem = unifiedStore.createUnifiedMediaItemData(
      mediaId,
      file.name,
      userSelectedSource,
    )

    // 添加到媒体库
    unifiedStore.addMediaItem(mediaItem)

    // 添加到当前目录
    unifiedStore.addMediaToDirectory(mediaId, currentDir.value.id)

    // 启动媒体处理流程
    unifiedStore.startMediaProcessing(mediaItem)

    console.log(t('media.fileProcessStarted', { name: file.name }))
  } catch (error) {
    console.error(t('media.fileProcessFailed', { name: file.name }), error)
  }
}

async function createTransitionTemplateAsset(): Promise<void> {
  if (!currentDir.value) {
    unifiedStore.messageError(t('media.selectDirectoryFirst'))
    return
  }

  const timestamp = Date.now()
  const assetId = generateAssetId('effect')
  const assetName = `转场_叠化_${timestamp}`
  const testTransitionCrossfadeFragmentShader = `#version 300 es
precision mediump float;

in vec2 v_uv;
out vec4 outColor;

uniform sampler2D u_fromTexture;
uniform sampler2D u_toTexture;
uniform float u_progress;

void main() {
  vec4 colorA = texture(u_fromTexture, v_uv);
  vec4 colorB = texture(u_toTexture, v_uv);
  float progress = clamp(u_progress, 0.0, 1.0);
  outColor = mix(colorA, colorB, progress);
}
`
  const asset = createTransitionTemplateAssetData(assetId, assetName, {
    durationFrames: 12,
    shader: {
      vertexShader: COPY_VERTEX_SHADER,
      fragmentShader: testTransitionCrossfadeFragmentShader,
    },
  })

  unifiedStore.addAsset(asset)
  unifiedStore.addAssetToDirectory(asset.id, currentDir.value.id)
  unifiedStore.messageSuccess('转场模板已创建')
}

// 提交AI生成任务到后端
async function submitAIGenerationTask(
  requestParams: MediaGenerationRequest,
): Promise<TaskSubmitResponse> {
  try {
    const response = await fetchClient.post<TaskSubmitResponse>(
      '/api/media/generate',
      requestParams,
    )

    if (response.status !== 200) {
      throw new Error(`提交任务失败: ${response.statusText}`)
    }

    return response.data
  } catch (error) {
    // 网络错误时返回失败响应
    return {
      success: false,
      error_code: TaskSubmitErrorCode.UNKNOWN_ERROR,
      error_details: {
        error: error instanceof Error ? error.message : '网络请求失败',
      },
    }
  }
}

// ==================== 取消功能 ====================

/**
 * 判断素材是否可以取消
 * 只有 pending 状态的任务才可以取消
 */
function canCancel(item: DisplayItem): boolean {
  if (item.type !== 'asset') return false

  const mediaItem = getMediaItem(item.id)
  if (!mediaItem) return false

  // 🌟 只有 pending 状态才可以取消
  return mediaItem.mediaStatus === 'pending'
}

/**
 * 处理取消操作
 */
async function handleCancelTask(): Promise<void> {
  if (!contextMenuTarget.value || contextMenuTarget.value.type !== 'asset') return

  const mediaItem = getMediaItem(contextMenuTarget.value.id)
  if (!mediaItem) return

  showContextMenu.value = false

  try {
    console.log(`🛑 [LibraryMediaGrid] 尝试取消任务: ${mediaItem.name}`)

    const success = await unifiedStore.cancelMediaProcessing(mediaItem.id)

    if (success) {
      unifiedStore.messageSuccess(t('media.cancelSuccess', { name: mediaItem.name }))
    } else {
      unifiedStore.messageWarning(t('media.cancelFailed', { name: mediaItem.name }))
    }
  } catch (error) {
    console.error('取消任务失败:', error)
    unifiedStore.messageError(
      t('media.cancelFailed', {
        name: mediaItem.name,
      }),
    )
  }
}

// ==================== 重试功能 ====================

/**
 * 判断素材是否可以重试
 */
function canRetry(item: DisplayItem): boolean {
  if (item.type !== 'asset') return false

  const mediaItem = getMediaItem(item.id)
  if (!mediaItem) return false

  // 只有错误或取消状态可以重试
  if (mediaItem.mediaStatus !== 'error' && mediaItem.mediaStatus !== 'cancelled') {
    return false
  }

  // 🌟 只有 AI 生成类型支持重试
  return mediaItem.source.type === 'ai-generation'
}

/**
 * 处理重试操作
 */
async function handleRetry(): Promise<void> {
  if (!contextMenuTarget.value || contextMenuTarget.value.type !== 'asset') return

  const mediaItem = getMediaItem(contextMenuTarget.value.id)
  if (!mediaItem) return

  showContextMenu.value = false

  try {
    // 🌟 只支持 AI 生成类型的重试
    if (mediaItem.source.type === 'ai-generation') {
      await retryAIGeneration(mediaItem)
    } else {
      // 其他类型不支持重试
      unifiedStore.messageWarning(t('media.retryNotSupported'))
      return
    }
  } catch (error) {
    console.error('重试失败:', error)
    unifiedStore.messageError(
      t('media.retryFailed', {
        error: error instanceof Error ? error.message : '未知错误',
      }),
    )
  }
}

/**
 * 重试AI生成素材
 */
async function retryAIGeneration(mediaItem: UnifiedMediaItemData): Promise<void> {
  const aiSource = mediaItem.source as AIGenerationSourceData

  // 1. 重新提交任务到后端
  const submitResult = await submitAIGenerationTask(aiSource.requestParams)

  if (!submitResult.success) {
    const errorMessage = buildTaskErrorMessage(
      submitResult.error_code,
      submitResult.error_details,
      t,
    )
    throw new Error(errorMessage)
  }

  // 2. 更新任务ID和状态
  aiSource.aiTaskId = submitResult.task_id
  aiSource.taskStatus = TaskStatus.PENDING
  aiSource.resultData = undefined

  // 3. 重置数据源状态
  aiSource.progress = 0
  aiSource.errorMessage = undefined

  // 4. 重置媒体状态
  mediaItem.mediaStatus = 'pending'

  // 5. 重新启动处理流程
  unifiedStore.startMediaProcessing(mediaItem)

  unifiedStore.messageSuccess(t('media.retryStarted', { name: mediaItem.name }))
}

// 移除资产（考虑引用计数）
function removeAssetItem(mediaId: string): void {
  if (!currentDir.value) return

  const mediaItem = getAsset(mediaId)

  // 如果资产不存在，直接移除无效引用
  if (!mediaItem) {
    unifiedStore.dialogWarning({
      title: t('media.deleteMedia'),
      content: t('media.deleteInvalidMedia', { id: mediaId }),
      positiveText: t('media.confirm'),
      negativeText: t('media.cancel'),
      draggable: true,
      onPositiveClick: async () => {
        try {
          const result = await unifiedStore.deleteAssetItem(mediaId, currentDir.value!.id)
          if (result.success) {
            unifiedStore.messageSuccess(t('media.invalidMediaRemoved'))
          } else {
            unifiedStore.messageError(t('media.deleteFailed'))
          }
        } catch (error) {
          console.error(`❌ 删除无效媒体失败: ${mediaId}`, error)
          unifiedStore.messageError(t('media.deleteFailed'))
        }
      },
    })
    return
  }

  // 检查引用计数
  const refCount = mediaItem.runtime.refCount || 0
  const isReferencedByOthers = refCount > 1

  // 构建确认对话框内容
  let confirmContent = ''
  if (isReferencedByOthers) {
    confirmContent = t('media.deleteMediaMultiRef', { name: mediaItem.name, count: refCount })
  } else if (refCount === 1) {
    confirmContent = t('media.deleteMediaSingleRef', { name: mediaItem.name })
  } else {
    // refCount === 0，孤立素材
    confirmContent = t('media.deleteMediaNoRef', { name: mediaItem.name })
  }

  unifiedStore.dialogWarning({
    title: t('media.deleteMedia'),
    content: confirmContent,
    positiveText: t('media.confirm'),
    negativeText: t('media.cancel'),
    draggable: true,
    onPositiveClick: async () => {
      try {
        const result = await unifiedStore.deleteAssetItem(mediaId, currentDir.value!.id)

        if (result.success) {
          if (result.deletedFile) {
            unifiedStore.messageSuccess(t('media.mediaDeletedWithFile', { name: mediaItem.name }))
          } else {
            unifiedStore.messageSuccess(t('media.mediaRemovedFromFolder', { name: mediaItem.name }))
          }
        } else {
          unifiedStore.messageError(t('media.deleteFailed', { name: mediaItem.name }))
        }
      } catch (error) {
        console.error(`❌ 删除媒体失败: ${mediaItem.name}`, error)
        unifiedStore.messageError(t('media.deleteFailed', { name: mediaItem.name }))
      }
    },
  })
}

// 删除文件夹
async function deleteFolder(folderId: string): Promise<void> {
  const folder = getDirectory(folderId)
  if (!folder) return

  unifiedStore.dialogWarning({
    title: t('media.deleteFolder'),
    content: t('media.deleteFolderConfirm', { name: folder.name }),
    positiveText: t('media.confirm'),
    negativeText: t('media.cancel'),
    draggable: true,
    onPositiveClick: async () => {
      try {
        const result = await unifiedStore.deleteDirectory(folderId)

        if (result.success) {
          const message =
            result.deletedMediaIds.length > 0
              ? t('media.folderDeletedWithMedia', {
                  name: folder.name,
                  count: result.deletedMediaIds.length,
                })
              : t('media.folderDeleted', { name: folder.name })

          unifiedStore.messageSuccess(message)

          // 如果当前标签页显示的是被删除的文件夹，切换到父文件夹
          if (currentDir.value?.id === folderId) {
            const parentId = folder.parentId
            if (parentId) {
              unifiedStore.navigateToDir(parentId)
            }
          }

          // 保存项目配置（目录结构已变更）
          await unifiedStore.saveCurrentProject({ directoryChanged: true })
        } else {
          unifiedStore.messageError(
            t('media.deleteFolderFailedWithReason', { name: folder.name, error: result.error }),
          )
        }
      } catch (error) {
        unifiedStore.messageError(
          t('media.deleteFolderFailedWithReason', {
            name: folder.name,
            error: error instanceof Error ? error.message : t('media.unknown'),
          }),
        )
      }
    },
  })
}

// ==================== 剪贴板操作 ====================

// 获取选中的显示项列表
function getSelectedDisplayItems(): DisplayItem[] {
  const selectedIds = Array.from(unifiedStore.selectedMediaItemIds)
  return displayItems.value.filter(item => selectedIds.includes(item.id))
}

// 剪切操作
function handleCut(): void {
  const selectedItems = getSelectedDisplayItems()
  if (selectedItems.length === 0) return
  unifiedStore.cut(selectedItems)
  showContextMenu.value = false
}

// 复制操作
function handleCopy(): void {
  const selectedItems = getSelectedDisplayItems()
  if (selectedItems.length === 0) return
  unifiedStore.copy(selectedItems)
  showContextMenu.value = false
}

// 粘贴操作
async function handlePaste(): Promise<void> {
  if (!currentDir.value) return

  showContextMenu.value = false

  const result = await unifiedStore.paste(currentDir.value.id)

  if (result.success) {
    unifiedStore.messageSuccess(t('media.pasteSuccess', { count: result.successCount }))
  } else {
    unifiedStore.messageError(
      t('media.pasteFailed', { error: result.errors[0]?.error || '未知错误' }),
    )
  }

  // 清空选择
  unifiedStore.clearMediaSelection()
}

// 粘贴到指定文件夹
async function handlePasteToFolder(folderId: string): Promise<void> {
  showContextMenu.value = false

  const result = await unifiedStore.paste(folderId)

  if (result.success) {
    unifiedStore.messageSuccess(t('media.pasteSuccess', { count: result.successCount }))
  } else {
    unifiedStore.messageError(
      t('media.pasteFailed', { error: result.errors[0]?.error || '未知错误' }),
    )
  }
}

// 清空剪贴板
function handleClearClipboard(): void {
  showContextMenu.value = false
  unifiedStore.clearClipboard()
  unifiedStore.messageSuccess(t('media.clipboardCleared'))
}

// ==================== 批量删除功能 ====================

// 批量删除处理
async function handleBatchDelete(): Promise<void> {
  showContextMenu.value = false
  const selectedItems = getSelectedDisplayItems()
  if (selectedItems.length === 0) return

  const itemCount = selectedItems.length

  unifiedStore.dialogWarning({
    title: t('media.batchDelete'),
    content: t('media.batchDeleteConfirmation', { count: itemCount }),
    positiveText: t('media.confirm'),
    negativeText: t('media.cancel'),
    draggable: true,
    onPositiveClick: async () => {
      let successCount = 0
      let failedCount = 0
      let hasDirectoryDeleted = false

      // 复制选中项列表
      const itemsToDelete = [...selectedItems]

      for (const item of itemsToDelete) {
        try {
          if (item.type === 'directory') {
            // 删除文件夹
            const result = await unifiedStore.deleteDirectory(item.id)
            if (result.success) {
              successCount++
              hasDirectoryDeleted = true
            } else {
              failedCount++
              console.error(`删除文件夹失败: ${item.id}`, result.error)
            }
          } else {
            // 删除媒体项
            if (currentDir.value) {
              const result = await unifiedStore.deleteMediaItem(item.id, currentDir.value.id)
              if (result.success) {
                successCount++
              } else {
                failedCount++
                console.error(`删除媒体项失败: ${item.id}`, result.error)
              }
            } else {
              failedCount++
              console.error(`删除媒体项失败: ${item.id}`, '当前目录不存在')
            }
          }
        } catch (error) {
          console.error(`删除项目失败: ${item.id}`, error)
          failedCount++
        }
      }

      // 清空选择
      unifiedStore.clearMediaSelection()

      // 显示结果消息
      if (failedCount === 0) {
        unifiedStore.messageSuccess(t('media.deleteComplete', { success: successCount, failed: 0 }))
      } else if (successCount === 0) {
        unifiedStore.messageError(t('media.deleteComplete', { success: 0, failed: failedCount }))
      } else {
        unifiedStore.messageWarning(
          t('media.deleteComplete', { success: successCount, failed: failedCount }),
        )
      }

      // 如果有目录被删除，保存项目配置
      if (hasDirectoryDeleted) {
        await unifiedStore.saveCurrentProject({ directoryChanged: true })
      }
    },
  })
}

// ==================== AI 描述分析功能 ====================


</script>

<style scoped>
/* 媒体网格样式 */
.media-grid {
  height: 100%;
  transition: background-color var(--transition-fast);
}

.media-grid.drag-over {
  background-color: var(--color-bg-hover);
  border: 1px dashed var(--color-accent-primary);
}

/* 空状态样式 */
.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  height: 100%;
  color: var(--color-text-secondary);
  text-align: center;
}

.empty-state p {
  margin: var(--spacing-sm) 0;
  font-size: var(--font-size-md);
}

.empty-state .hint {
  font-size: var(--font-size-sm);
  color: var(--color-text-muted);
}

/* 内容列表样式 - 图标视图 */
.content-list {
  display: grid;
  gap: var(--spacing-sm);
  padding: var(--spacing-sm);
}

/* 大图标视图 */
.content-list.view-large-icon {
  grid-template-columns: repeat(auto-fill, minmax(140px, 1fr));
  gap: var(--spacing-md);
}

.content-list.view-large-icon .item-draggable-area {
  width: 120px;
  height: 120px;
}

.content-list.view-large-icon .item-name {
  max-width: 130px;
  font-size: var(--font-size-sm);
}

/* 中等图标视图（默认） */
.content-list.view-medium-icon {
  grid-template-columns: repeat(auto-fill, minmax(100px, 1fr));
  gap: var(--spacing-sm);
}

.content-list.view-medium-icon .item-draggable-area {
  width: 80px;
  height: 80px;
}

.content-list.view-medium-icon .item-name {
  max-width: 90px;
}

/* 小图标视图 */
.content-list.view-small-icon {
  grid-template-columns: repeat(auto-fill, minmax(70px, 1fr));
  gap: var(--spacing-xs);
}

.content-list.view-small-icon .item-draggable-area {
  width: 48px;
  height: 48px;
}

.content-list.view-small-icon .item-name {
  max-width: 60px;
  font-size: var(--font-size-xs);
}

.content-item {
  background-color: transparent;
  border: 1px solid transparent;
  border-radius: var(--border-radius-small);
  display: flex;
  flex-direction: column;
  align-items: center;
  transition: all var(--transition-fast);
  position: relative;
  padding: 4px;
}

.content-item.selected {
  background-color: rgba(59, 130, 246, 0.1);
  border: 1px dashed var(--color-accent-primary);
  border-radius: var(--border-radius-small);
}

.item-draggable-area {
  width: 64px;
  height: 64px;
  display: flex;
  align-items: center;
  justify-content: center;
  margin-bottom: 4px;
  border-radius: 8px;
  overflow: hidden;
  cursor: pointer;
  transition: all var(--transition-fast);
  background-color: transparent;
}

.item-draggable-area:hover {
  background-color: rgba(255, 255, 255, 0.05);
  transform: scale(1.05);
}

.item-icon {
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 8px;
  overflow: hidden;
}

.directory-icon {
  background-color: transparent;
  color: var(--color-accent-primary);
  border-radius: 8px;
}

.media-icon {
  background-color: transparent;
  border-radius: 8px;
}

.item-name {
  font-size: var(--font-size-xs);
  color: var(--color-text-primary);
  text-align: center;
  width: 100%;
  max-width: 90px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  line-height: 1.2;
  cursor: default;
  padding: 2px;
  border-radius: 2px;
}

.item-name:hover {
  background-color: rgba(255, 255, 255, 0.05);
}

/* 剪切状态样式 */
.content-item.is-cut {
  opacity: 0.5;
  position: relative;
}

.content-item.is-cut .item-draggable-area::after {
  content: '✂️';
  position: absolute;
  top: 2px;
  right: 2px;
  font-size: 12px;
  z-index: 1;
}

/* 复制状态样式 */
.content-item.is-copy {
  position: relative;
}

.content-item.is-copy .item-draggable-area::after {
  content: '📋';
  position: absolute;
  top: 2px;
  right: 2px;
  font-size: 12px;
  z-index: 1;
}

/* 文件夹拖拽目标样式 */
.content-item.drag-over-folder {
  background-color: rgba(59, 130, 246, 0.05);
}

.content-item.drag-over-folder .item-draggable-area {
  transform: scale(1.05);
}

.content-item.can-drop-folder {
  border: 1px solid #28a745;
  background-color: rgba(40, 167, 69, 0.1);
}

.content-item.cannot-drop-folder {
  border: 1px solid #dc3545;
  background-color: rgba(220, 53, 69, 0.1);
}

.content-item.can-drop-folder .directory-icon {
  color: #28a745;
  animation: pulse 1s ease-in-out infinite;
}

.content-item.cannot-drop-folder .directory-icon {
  color: #dc3545;
}

@keyframes pulse {
  0%,
  100% {
    opacity: 1;
  }
  50% {
    opacity: 0.6;
  }
}

/* 列表视图样式 */
.content-list-view {
  display: flex;
  flex-direction: column;
  padding: var(--spacing-sm);
  gap: 2px;
}

.list-item {
  display: grid;
  grid-template-columns: 48px 1fr 50px;
  gap: var(--spacing-md);
  align-items: center;
  padding: var(--spacing-xs) var(--spacing-sm);
  border-radius: var(--border-radius-small);
  transition: all var(--transition-fast);
  cursor: pointer;
  border: 1px solid transparent;
}

.list-item:hover {
  background-color: rgba(255, 255, 255, 0.05);
}

.list-item.selected {
  background-color: rgba(59, 130, 246, 0.1);
  border: 1px solid var(--color-accent-primary);
}

.list-item.is-cut {
  opacity: 0.5;
}

.list-item.is-cut::before {
  content: '✂️';
  position: absolute;
  left: 8px;
  font-size: 12px;
}

.list-item.is-copy::before {
  content: '📋';
  position: absolute;
  left: 8px;
  font-size: 12px;
}

.list-item.drag-over-folder {
  background-color: rgba(59, 130, 246, 0.05);
}

.list-item.can-drop-folder {
  border: 1px solid #28a745;
  background-color: rgba(40, 167, 69, 0.1);
}

.list-item.cannot-drop-folder {
  border: 1px solid #dc3545;
  background-color: rgba(220, 53, 69, 0.1);
}

.list-item-icon {
  width: 32px;
  height: 32px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 4px;
  overflow: hidden;
  flex-shrink: 0;
}

.list-item-name {
  font-size: var(--font-size-base);
  color: var(--color-text-primary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  text-align: left;
}

.list-item-type {
  font-size: var(--font-size-base);
  color: var(--color-text-secondary);
  text-align: left;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.template-icon {
  background: linear-gradient(135deg, rgba(255, 173, 66, 0.18), rgba(255, 110, 64, 0.08));
  border: 1px solid rgba(255, 173, 66, 0.22);
}

.effect-template-thumbnail {
  width: 100%;
  height: 100%;
  min-height: 72px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 6px;
  color: #ffb36b;
}

.effect-template-tag {
  font-size: 12px;
  font-weight: 600;
  color: var(--color-text-primary);
}

.effect-template-summary {
  font-size: 11px;
  color: var(--color-text-secondary);
}

.effect-template-list-icon {
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #ffb36b;
}
</style>
