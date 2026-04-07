/**
 * 统一拖拽管理器 Composable
 * 负责协调源处理器和目标处理器
 */

import {
  DragSourceType,
} from '@/core/types/drag'
import type {
  DropTargetType,
  DragSourceHandler,
  DropTargetHandler,
  UnifiedDragData,
  DropTargetInfo,
  DropResult,
} from '@/core/types/drag'
import type { UnifiedDirectoryModule } from '@/core/modules/UnifiedDirectoryModule'
import type { UnifiedMediaModule } from '@/core/modules/UnifiedMediaModule'
import type { UnifiedTimelineModule } from '@/core/modules/UnifiedTimelineModule'
import type { UnifiedSelectionModule } from '@/core/modules/UnifiedSelectionModule'
import type { UnifiedTrackModule } from '@/core/modules/UnifiedTrackModule'

// 导入所有处理器
import {
  MediaItemSourceHandler,
  FolderSourceHandler,
  TimelineItemSourceHandler,
} from '@/core/drag/sources'
import {
  FolderTargetHandler,
  TabTargetHandler,
  TimelineTrackTargetHandler,
  AIGenerationPanelTargetHandler,
} from '@/core/drag/targets'

/**
 * 统一拖拽管理器 Composable
 * @param directoryModule - 目录模块实例，用于处理文件夹和标签页相关的拖拽操作
 * @param mediaModule - 媒体模块实例，用于查询素材项目信息
 * @param timelineModule - 时间轴模块实例，用于查询时间轴项目信息
 * @param selectionModule - 选择模块实例，用于获取选中的时间轴项目
 * @param trackModule - 轨道模块实例，用于查询轨道信息
 */
export function useUnifiedDrag(
  directoryModule: UnifiedDirectoryModule,
  mediaModule: UnifiedMediaModule,
  timelineModule: UnifiedTimelineModule,
  selectionModule: UnifiedSelectionModule,
  trackModule: UnifiedTrackModule,
) {
  // 存储处理器
  const sourceHandlers = new Map<DragSourceType, DragSourceHandler>()
  const targetHandlers = new Map<DropTargetType, DropTargetHandler>()

  // 当前拖拽数据
  let currentDragData: UnifiedDragData | null = null

  /**
   * 注册拖拽源处理器
   */
  function registerSourceHandler(handler: DragSourceHandler): void {
    sourceHandlers.set(handler.sourceType, handler)
    console.log(`✅ [UnifiedDrag] 注册源处理器: ${handler.sourceType}`)
  }

  /**
   * 注册拖拽目标处理器
   */
  function registerTargetHandler(handler: DropTargetHandler): void {
    targetHandlers.set(handler.targetType, handler)
    console.log(`✅ [UnifiedDrag] 注册目标处理器: ${handler.targetType}`)
  }

  /**
   * 开始拖拽（由源处理器调用）
   */
  function startDrag(event: DragEvent, dragData: UnifiedDragData): void {
    currentDragData = dragData

    console.log(`🎯 [UnifiedDrag] 开始拖拽:`, {
      sourceType: dragData.sourceType,
      timestamp: dragData.timestamp,
    })
    if (event.dataTransfer) {
      event.dataTransfer.effectAllowed = 'move'
      // 添加内部拖拽标记，用于区分外部文件拖拽
      event.dataTransfer.setData('application/x-unified-drag', 'true')
    }
  }

  /**
   * 处理拖拽悬停（由目标元素调用）
   */
  function handleDragOver(event: DragEvent, targetInfo: DropTargetInfo): boolean {
    // 检查是否为内部统一拖拽
    if (!event.dataTransfer?.types.includes('application/x-unified-drag')) {
      return false
    }

    const dragData = getCurrentDragData(event)
    if (!dragData) return false

    // 查找目标处理器
    const targetHandler = targetHandlers.get(targetInfo.targetType)
    if (!targetHandler) {
      console.warn(`⚠️ [UnifiedDrag] 未找到目标处理器: ${targetInfo.targetType}`)
      return false
    }

    // 检查目标是否接受此拖拽源
    if (!targetHandler.canAccept(dragData)) {
      return false
    }

    const allowed = targetHandler.handleDragOver(event, dragData, targetInfo)

    // 设置拖拽效果
    if (event.dataTransfer) {
      if (allowed) {
        event.dataTransfer.dropEffect = 'move'
      } else {
        event.dataTransfer.dropEffect = 'none'
      }
    }

    return allowed
  }

  /**
   * 处理拖拽放置（由目标元素调用）
   */
  async function handleDrop(event: DragEvent, targetInfo: DropTargetInfo): Promise<DropResult> {
    // 检查是否为内部统一拖拽
    if (!event.dataTransfer?.types.includes('application/x-unified-drag')) {
      return { success: false }
    }

    const dragData = getCurrentDragData(event)
    if (!dragData) {
      console.warn(`⚠️ [UnifiedDrag] 无拖拽数据`)
      return { success: false }
    }

    // 查找目标处理器
    const targetHandler = targetHandlers.get(targetInfo.targetType)
    if (!targetHandler) {
      console.warn(`⚠️ [UnifiedDrag] 未找到目标处理器: ${targetInfo.targetType}`)
      return { success: false }
    }

    // 检查目标是否接受此拖拽源
    if (!targetHandler.canAccept(dragData)) {
      console.warn(`⚠️ [UnifiedDrag] 目标不接受此拖拽源`)
      return { success: false }
    }

    console.log(`📦 [UnifiedDrag] 处理放置:`, {
      sourceType: dragData.sourceType,
      targetType: targetInfo.targetType,
      targetId: 'targetId' in targetInfo ? targetInfo.targetId : undefined,
    })

    const result = await targetHandler.handleDrop(event, dragData, targetInfo)

    if (result.success) {
      console.log(`✅ [UnifiedDrag] 拖拽成功`)
    } else {
      console.warn(`⚠️ [UnifiedDrag] 拖拽失败`)
    }

    endDrag()
    return result
  }

  /**
   * 结束拖拽
   */
  function endDrag(): void {
    if (currentDragData) {
      console.log(`🏁 [UnifiedDrag] 结束拖拽: ${currentDragData.sourceType}`)
    }
    currentDragData = null
  }

  /**
   * 获取当前拖拽数据
   */
  function getCurrentDragData(event: DragEvent): UnifiedDragData | null {
    // 直接返回内存中的数据
    return currentDragData
  }

  /**
   * 获取源处理器
   */
  function getSourceHandler(sourceType: DragSourceType): DragSourceHandler | undefined {
    return sourceHandlers.get(sourceType)
  }

  /**
   * 获取目标处理器
   */
  function getTargetHandler(targetType: DropTargetType): DropTargetHandler | undefined {
    return targetHandlers.get(targetType)
  }

  // ==================== 自动注册所有处理器 ====================

  console.log(`🎯 [UnifiedDrag] 开始自动注册所有处理器`)

  // 注册源处理器
  const assetSourceHandler = new MediaItemSourceHandler(mediaModule, directoryModule)
  registerSourceHandler(assetSourceHandler)
  sourceHandlers.set(DragSourceType.MEDIA_ITEM, assetSourceHandler)
  registerSourceHandler(new FolderSourceHandler(directoryModule))
  registerSourceHandler(new TimelineItemSourceHandler(timelineModule, selectionModule))

  // 注册目标处理器
  registerTargetHandler(new FolderTargetHandler(directoryModule))
  registerTargetHandler(new TabTargetHandler(directoryModule))
  registerTargetHandler(
    new TimelineTrackTargetHandler(timelineModule, selectionModule, trackModule),
  )
  registerTargetHandler(new AIGenerationPanelTargetHandler(mediaModule, timelineModule))

  console.log(
    `✅ [UnifiedDrag] 所有处理器注册完成 (${sourceHandlers.size}个源处理器, ${targetHandlers.size}个目标处理器)`,
  )

  // 返回管理器接口（不导出注册方法）
  return {
    // 核心方法
    startDrag,
    handleDragOver,
    handleDrop,
    endDrag,
    getCurrentDragData,

    // 查询方法
    getSourceHandler,
    getTargetHandler,
  }
}

/**
 * 导出管理器类型
 */
export type UnifiedDragManager = ReturnType<typeof useUnifiedDrag>
