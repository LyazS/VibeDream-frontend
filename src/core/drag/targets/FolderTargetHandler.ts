/**
 * 文件夹拖拽目标处理器
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

export class FolderTargetHandler implements DropTargetHandler {
  readonly targetType: DropTargetType = TargetType.FOLDER

  constructor(private directoryModule: UnifiedDirectoryModule) {}

  canAccept(dragData: UnifiedDragData): boolean {
    // 接受素材项目和文件夹
    return (
      dragData.sourceType === DragSourceType.ASSET ||
      dragData.sourceType === DragSourceType.MEDIA_ITEM ||
      dragData.sourceType === DragSourceType.FOLDER
    )
  }

  handleDragOver(event: DragEvent, dragData: UnifiedDragData, targetInfo: DropTargetInfo): boolean {
    // 类型检查：确保是 FOLDER 目标类型
    if (targetInfo.targetType !== TargetType.FOLDER) {
      return false
    }
    
    // 类型断言：现在可以安全访问 targetId
    const folderTargetInfo = targetInfo as FolderOrTabDropTargetInfo
    
    // 根据拖拽源类型设置不同的拖拽效果
    switch (dragData.sourceType) {
      case DragSourceType.ASSET:
      case DragSourceType.MEDIA_ITEM: {
        const mediaData = dragData as MediaItemDragData
        // 检查是否拖拽到同一个文件夹
        if (mediaData.sourceFolderId === folderTargetInfo.targetId) {
          return false
        }

        return true
      }

      case DragSourceType.FOLDER: {
        const folderData = dragData as FolderDragData
        // 使用 directoryModule 的验证方法
        if (!this.directoryModule.canDragToFolder(folderData.folderId, folderTargetInfo.targetId)) {
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
    // 根据拖拽源类型执行不同的操作
    switch (dragData.sourceType) {
      case DragSourceType.ASSET:
      case DragSourceType.MEDIA_ITEM:
        return this.handleMediaItemDrop(dragData as MediaItemDragData, targetInfo)

      case DragSourceType.FOLDER:
        return this.handleFolderDrop(dragData as FolderDragData, targetInfo)

      default:
        return { success: false }
    }
  }

  private async handleMediaItemDrop(
    dragData: MediaItemDragData,
    targetInfo: DropTargetInfo,
  ): Promise<DropResult> {
    // 类型检查
    if (targetInfo.targetType !== TargetType.FOLDER) {
      return { success: false }
    }
    
    const folderTargetInfo = targetInfo as FolderOrTabDropTargetInfo
    
    try {
      console.log(`📦 [FolderTargetHandler] 移动素材项到文件夹:`, {
        mediaItemIds: dragData.assetIds,
        sourceFolderId: dragData.sourceFolderId,
        targetFolderId: folderTargetInfo.targetId,
      })

      // 使用 directoryModule 的拖拽移动方法
      await this.directoryModule.dragMoveMediaItems(
        dragData.assetIds,
        dragData.sourceFolderId || null,
        folderTargetInfo.targetId,
      )

      console.log(`✅ [FolderTargetHandler] 素材项移动成功`)
      return { success: true }
    } catch (error) {
      console.error('❌ [FolderTargetHandler] 移动素材失败:', error)
      return { success: false }
    }
  }

  private async handleFolderDrop(
    dragData: FolderDragData,
    targetInfo: DropTargetInfo,
  ): Promise<DropResult> {
    // 类型检查
    if (targetInfo.targetType !== TargetType.FOLDER) {
      return { success: false }
    }
    
    const folderTargetInfo = targetInfo as FolderOrTabDropTargetInfo
    
    try {
      console.log(`📁 [FolderTargetHandler] 移动文件夹:`, {
        folderId: dragData.folderId,
        targetFolderId: folderTargetInfo.targetId,
      })

      // 使用 directoryModule 的拖拽移动方法
      await this.directoryModule.dragMoveFolder(dragData.folderId, folderTargetInfo.targetId)

      console.log(`✅ [FolderTargetHandler] 文件夹移动成功`)
      return { success: true }
    } catch (error) {
      console.error('❌ [FolderTargetHandler] 移动文件夹失败:', error)
      return { success: false }
    }
  }
}
