import { useUnifiedStore } from '@/core/unifiedStore'
import type { Ref } from 'vue'
import { useTimelineWheelHandler, TimelineWheelSource } from './useTimelineWheelHandler'
import { buildClipSelectionId } from '@/core/types/timelineSelection'

/**
 * 时间轴事件处理模块
 * 提供时间轴相关的事件处理功能，包括点击、滚轮、键盘等事件
 */
export function useTimelineEventHandlers(
  timelineBody: Ref<HTMLElement | undefined>,
  handleTimelineItemRemove: (timelineItemId: string) => Promise<void>,
) {
  const unifiedStore = useUnifiedStore()

  /**
   * 处理时间轴容器点击事件
   * 点击时间轴容器的空白区域取消所有选中
   */
  function handleTimelineContainerClick(event: MouseEvent) {
    // 点击时间轴容器的空白区域取消所有选中
    const target = event.target as HTMLElement

    // 检查点击的是否是时间轴容器本身或其他空白区域
    // 排除点击在VideoClip、按钮、输入框等交互元素上的情况
    if (
      target.classList.contains('timeline-header') ||
      target.classList.contains('timeline-body') ||
      target.classList.contains('timeline-grid') ||
      target.classList.contains('grid-line') ||
      target.classList.contains('track-row')
    ) {
      // 清除时间轴选择（不记录历史记录）
      unifiedStore.clearTimelineSelection()
    }
  }

  /**
   * 处理时间轴点击事件
   * 点击轨道内容空白区域取消所有选中（包括单选和多选）
   */
  async function handleTimelineClick(event: MouseEvent) {
    // 点击轨道内容空白区域取消所有选中（包括单选和多选）
    const target = event.target as HTMLElement
    if (target.classList.contains('track-content')) {
      // 阻止事件冒泡，避免触发容器的点击事件
      event.stopPropagation()

      // 清除时间轴选择（不记录历史记录）
      unifiedStore.clearAllSelections()
    }
  }

  /**
   * 处理片段选中事件
   */
  async function handleSelectClip(event: MouseEvent, clipId: string) {
    const selectionId = buildClipSelectionId(clipId)
    console.log(
      '🎯 [UnifiedTimeline] 选中clip:',
      clipId,
      'Ctrl按下:',
      event.ctrlKey || event.metaKey,
    )
    if (event.ctrlKey || event.metaKey) {
      unifiedStore.selectTimelineSelections([selectionId], 'toggle')
    } else {
      unifiedStore.selectTimelineSelections([selectionId], 'replace')
    }
  }

  /**
   * 处理时间轴项目双击事件
   */
  function handleTimelineItemDoubleClick(id: string) {
    // 处理时间轴项目双击
    console.log('Timeline item double click:', id)
  }

  /**
   * 处理时间轴项目调整大小开始事件
   */
  function handleTimelineItemResizeStart(
    event: MouseEvent,
    itemId: string,
    direction: 'left' | 'right',
  ) {
    // 处理时间轴项目调整大小开始
    console.log('🔧 [UnifiedTimeline] 时间轴项目开始调整大小:', {
      itemId,
      direction,
      clientX: event.clientX,
      clientY: event.clientY,
    })

    // 暂停播放以便进行编辑
    unifiedStore.pause()

    // 确保项目被选中（如果还没有选中的话）
    const selectionId = buildClipSelectionId(itemId)
    if (!unifiedStore.isTimelineSelectionSelected(selectionId)) {
      unifiedStore.selectTimelineSelections([selectionId], 'replace')
    }
  }

  /**
   * 处理键盘事件
   */
  async function handleKeyDown(event: KeyboardEvent) {
    // 检查是否有修饰键（除了Escape和Delete），如果有则不处理（让全局快捷键处理）
    if (
      (event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) &&
      event.key !== 'Escape' &&
      event.key !== 'Delete'
    ) {
      return
    }

    // 按 Escape 键取消选中
    if (event.key === 'Escape') {
      unifiedStore.clearTimelineSelection()
    }

    // 按 Delete 键删除选中的项目
    if (event.key === 'Delete') {
      const selectedItems = unifiedStore.selectedClipTimelineItemIds
      if (selectedItems.length > 0) {
        for (const itemId of selectedItems) {
          await handleTimelineItemRemove(itemId)
        }
      }
    }
  }

  // 使用统一的滚轮处理
  const { handleWheel } = useTimelineWheelHandler(timelineBody, {
    source: TimelineWheelSource.TIMELINE_BODY, // 时间轴主体区域
  })

  return {
    // 方法
    handleTimelineContainerClick,
    handleWheel,
    handleTimelineClick,
    handleSelectClip,
    handleTimelineItemDoubleClick,
    handleTimelineItemResizeStart,
    handleKeyDown,
  }
}
