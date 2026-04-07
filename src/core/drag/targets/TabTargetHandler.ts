/**
 * 标签页拖拽目标处理器
 * 接受：素材项目、文件夹
 */

import type {
  DropTargetHandler,
  DropTargetType,
  UnifiedDragData,
  MediaItemDragData,
  FolderDragData,
  DropTargetInfo,
  FolderOrTabDropTargetInfo,
  DropResult,
} from '@/core/types/drag'
import { DropTargetType as TargetType, DragSourceType } from '@/core/types/drag'
import type { UnifiedDirectoryModule } from '@/core/modules/UnifiedDirectoryModule'

export class TabTargetHandler implements DropTargetHandler {
  readonly targetType: DropTargetType = TargetType.TAB

  constructor(private directoryModule: UnifiedDirectoryModule) {}

  canAccept(dragData: UnifiedDragData): boolean {
    // 只接受素材项目和文件夹
    return (
      dragData.sourceType === DragSourceType.ASSET ||
      dragData.sourceType === DragSourceType.MEDIA_ITEM ||
      dragData.sourceType === DragSourceType.FOLDER
    )
  }

  handleDragOver(event: DragEvent, dragData: UnifiedDragData, targetInfo: DropTargetInfo): boolean {
    // 类型检查
    if (targetInfo.targetType !== TargetType.TAB) {
      return false
    }
    
    const tabTargetInfo = targetInfo as FolderOrTabDropTargetInfo
    
    // 获取目标标签页信息
    const targetTab = this.directoryModule.openTabs.value.find(
      (tab) => tab.id === tabTargetInfo.targetId,
    )
    if (!targetTab) {
      console.error(`❌ [TabTargetHandler] 目标标签页不存在: ${tabTargetInfo.targetId}`)
      return false
    }

    const targetDirId = targetTab.dirId

    // 根据拖拽源类型分别处理
    switch (dragData.sourceType) {
      case DragSourceType.ASSET:
      case DragSourceType.MEDIA_ITEM: {
        const mediaData = dragData as MediaItemDragData

        // 检查是否拖拽到同一个文件夹（更精确的判断）
        if (mediaData.sourceFolderId === targetDirId) {
          return false
        }

        // 可以添加素材项特定的验证逻辑
        // 例如：检查目标文件夹是否接受该类型的媒体文件
        return true
      }

      case DragSourceType.FOLDER: {
        const folderData = dragData as FolderDragData

        // 检查是否拖拽到同一个文件夹（更精确的判断）
        if (folderData.folderId === targetDirId) {
          return false
        }

        // 检查是否拖拽到父文件夹（防止循环嵌套）
        if (folderData.sourceFolderId === targetDirId) {
          return false
        }

        // 检查是否拖拽到自己的子孙文件夹（防止循环嵌套）
        if (this.directoryModule.isDescendantOf(targetDirId, folderData.folderId)) {
          return false
        }

        return true
      }

      default:
        return false
    }
  }

  async handleDrop(
    event: DragEvent,
    dragData: UnifiedDragData,
    targetInfo: DropTargetInfo,
  ): Promise<DropResult> {
    // 类型检查
    if (targetInfo.targetType !== TargetType.TAB) {
      return { success: false }
    }
    
    const tabTargetInfo = targetInfo as FolderOrTabDropTargetInfo
    
    // 获取目标标签页
    const targetTab = this.directoryModule.openTabs.value.find(
      (tab) => tab.id === tabTargetInfo.targetId,
    )
    if (!targetTab) {
      console.error(`❌ [TabTargetHandler] 目标标签页不存在: ${tabTargetInfo.targetId}`)
      return { success: false }
    }

    // 获取目标标签页的当前目录作为目标
    const targetDirId = targetTab.dirId

    try {
      // 根据拖拽源类型执行不同的操作
      switch (dragData.sourceType) {
        case DragSourceType.ASSET:
        case DragSourceType.MEDIA_ITEM: {
          const mediaData = dragData as MediaItemDragData

          await this.directoryModule.dragMoveMediaItems(
            mediaData.assetIds,
            mediaData.sourceFolderId || null,
            targetDirId,
          )

          return { success: true }
        }

        case DragSourceType.FOLDER: {
          const folderData = dragData as FolderDragData

          await this.directoryModule.dragMoveFolder(folderData.folderId, targetDirId)

          return { success: true }
        }

        default:
          return { success: false }
      }
    } catch (error) {
      console.error('❌ [TabTargetHandler] 拖拽到标签页失败:', error)
      return { success: false }
    }
  }
}
