import { TimelineItemQueries } from '@/core/timelineitem/queries'
import type { UnifiedTimelineItemData } from '@/core/timelineitem/type'
import type { MediaType, UnifiedMediaItemData } from '@/core/mediaitem/types'
import type { FrameData } from '@/core/webgl2/types'

/**
 * 当前第一阶段允许进入 WebGL 渲染链的 item 类型。
 */
export type VisualRenderableItem =
  | UnifiedTimelineItemData<'video'>
  | UnifiedTimelineItemData<'image'>
  | UnifiedTimelineItemData<'text'>

/**
 * 可见性筛选所需的外部上下文。
 */
interface VisibilityContext {
  currentFrame: number
  canvasWidth: number
  canvasHeight: number
  bunnyCurFrameMap: Map<string, FrameData>
  getTrack: (trackId: string) => { isVisible: boolean } | undefined
  getMediaItem: (mediaItemId: string) => UnifiedMediaItemData | undefined
  trackIndexMap: Map<string, number>
  selectedBoundaryItemId: string | null
  selectedBoundaryTrackId: string | null
}

/**
 * 纯 CPU 侧边界检查。
 *
 * 这里只按未旋转包围盒做快速裁剪，目标是减少明显不可见 item 的 draw call。
 * 这不是精确裁剪，但对第一阶段足够，而且开销很低。
 * 项目坐标系以画布中心为原点，Y 向上为正。
 */
function isInBounds(
  item: UnifiedTimelineItemData<MediaType>,
  canvasWidth: number,
  canvasHeight: number,
): boolean {
  if (!TimelineItemQueries.hasVisualProperties(item)) {
    return false
  }

  const config = TimelineItemQueries.getRenderConfig(item).visual
  const halfW = config.width / 2
  const halfH = config.height / 2
  const canvasHalfWidth = canvasWidth / 2
  const canvasHalfHeight = canvasHeight / 2

  return (
    config.x + halfW >= -canvasHalfWidth &&
    config.x - halfW <= canvasHalfWidth &&
    config.y + halfH >= -canvasHalfHeight &&
    config.y - halfH <= canvasHalfHeight
  )
}

/**
 * 过滤出当前帧真正需要进入渲染链的 item，并按轨道顺序排序。
 *
 * 过滤条件包括：
 * - 时间范围命中
 * - 轨道可见
 * - source 已就绪
 * - 粗略边界检查命中
 */
export function getVisibleRenderableItems(
  timelineItems: UnifiedTimelineItemData<MediaType>[],
  context: VisibilityContext,
): VisualRenderableItem[] {
  return timelineItems
    .filter((item) => {
      const isSelectedBoundaryItem = context.selectedBoundaryItemId === item.id
      if (
        context.currentFrame < item.timeRange.timelineStartTime ||
        context.currentFrame >= item.timeRange.timelineEndTime
      ) {
        if (!isSelectedBoundaryItem) {
          return false
        }
      }

      if (
        context.selectedBoundaryTrackId &&
        item.id !== context.selectedBoundaryItemId &&
        item.trackId === context.selectedBoundaryTrackId &&
        item.timeRange.timelineStartTime === context.currentFrame
      ) {
        return false
      }

      const track = context.getTrack(item.trackId)
      if (track && !track.isVisible) {
        return false
      }

      if (!TimelineItemQueries.hasVisualProperties(item)) {
        return false
      }

      if (TimelineItemQueries.isVideoTimelineItem(item)) {
        const frameData = context.bunnyCurFrameMap.get(item.id)
        if (!frameData) return false

        if (isSelectedBoundaryItem) {
          const clipTailFrame = Math.max(
            item.timeRange.timelineStartTime,
            item.timeRange.timelineEndTime - 1,
          )
          if (
            frameData.frameNumber !== context.currentFrame &&
            frameData.frameNumber !== clipTailFrame
          ) {
            return false
          }
        }
      } else if (TimelineItemQueries.isTextTimelineItem(item)) {
        if (!item.runtime.textBitmap) return false
      } else if (TimelineItemQueries.isImageTimelineItem(item)) {
        if (!context.getMediaItem(item.mediaItemId)?.runtime.bunny?.imageClip) return false
      } else {
        return false
      }

      return isInBounds(item, context.canvasWidth, context.canvasHeight)
    })
    .sort((a, b) => {
      const aIndex = context.trackIndexMap.get(a.trackId) ?? -Infinity
      const bIndex = context.trackIndexMap.get(b.trackId) ?? -Infinity
      return bIndex - aIndex
    }) as VisualRenderableItem[]
}
