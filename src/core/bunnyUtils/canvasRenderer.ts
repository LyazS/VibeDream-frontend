/**
 * Canvas 渲染工具函数
 *
 * 从 UnifiedMediaBunnyModule 中提取的渲染相关功能
 * 用于将时间轴项目渲染到 Canvas 上
 */

import type { UnifiedTimelineItemData } from '@/core/timelineitem/type'
import type { MediaType, UnifiedMediaItemData } from '@/core/mediaitem/types'
import type { VisualProps } from '@/core/timelineitem/bunnytype'
import { TimelineItemQueries } from '@/core/timelineitem/queries'
import type { VideoSample } from 'mediabunny'

/**
 * 帧数据接口
 * 包含帧数和对应的 VideoSample
 */
export interface FrameData {
  frameNumber: number
  videoSample: VideoSample
  clockwiseRotation: number
}

/**
 * 渲染上下文接口
 * 包含渲染所需的所有依赖
 */
export interface RenderContext {
  canvas: HTMLCanvasElement
  ctx: CanvasRenderingContext2D
  bunnyCurFrameMap: Map<string, FrameData>
  getTrack: (trackId: string) => { isVisible: boolean } | undefined
  getMediaItem: (mediaItemId: string) => UnifiedMediaItemData | undefined
  trackIndexMap: Map<string, number>
}

/**
 * 检查元素是否在画布边界内
 * 用于性能优化，跳过完全在画布外的元素
 * 注意：config.x, config.y 是相对于画布中心的坐标
 * @param config 视觉属性配置
 * @param canvasWidth 画布宽度
 * @param canvasHeight 画布高度
 * @returns 是否在边界内
 */
export function isInBounds(
  config: VisualProps,
  canvasWidth: number,
  canvasHeight: number,
): boolean {
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
 * 渲染单个项目
 * 应用所有 config 中的变换属性
 *
 * 坐标系统说明：
 * - 画布原点已在 renderToCanvas 中移动到画布中心
 * - config.x, config.y 是相对于画布中心的坐标
 * - 元素原点在元素中心
 *
 * @param item 时间轴项目
 * @param ctx Canvas 2D 上下文
 * @param bunnyCurFrameMap 帧数据映射表
 * @param getMediaItem 获取媒体项目的函数
 */
export function renderItem(
  item: UnifiedTimelineItemData<MediaType>,
  ctx: CanvasRenderingContext2D,
  bunnyCurFrameMap: Map<string, FrameData>,
  getMediaItem: (mediaItemId: string) => UnifiedMediaItemData | undefined,
): void {
  // 检查是否有视觉属性（纯音频项目无需渲染）
  if (!TimelineItemQueries.hasVisualProperties(item)) {
    return
  }

  // ✅ 使用辅助函数获取渲染配置
  const visualConfig = TimelineItemQueries.getRenderConfig(item)

  // 统一使用 save/restore 模式
  ctx.save()

  try {
    // === 应用变换（顺序很重要！）===

    // 1. 移动到目标位置（相对于画布中心）
    // 注意：画布原点已经在画布中心，所以 config.x, config.y 直接使用
    ctx.translate(visualConfig.x, visualConfig.y)

    // 2. 应用旋转（围绕中心点旋转）
    // 先应用视频本身的顺时针旋转，再应用用户设置的旋转
    let clockwiseRotation = 0
    if (TimelineItemQueries.isVideoTimelineItem(item)) {
      const frameData = bunnyCurFrameMap.get(item.id)
      if (frameData) {
        clockwiseRotation = frameData.clockwiseRotation
        if (clockwiseRotation !== 0) {
          ctx.rotate((clockwiseRotation * Math.PI) / 180)
        }
      }
    }
    if (visualConfig.rotation !== 0) {
      ctx.rotate(visualConfig.rotation)
    }

    // 3. 应用不透明度
    if (visualConfig.opacity !== undefined && visualConfig.opacity !== 1) {
      ctx.globalAlpha = visualConfig.opacity
    }

    // 4. 获取尺寸
    // 如果视频旋转了 90° 或 270°，需要交换宽度和高度
    let width = visualConfig.width
    let height = visualConfig.height
    if (TimelineItemQueries.isVideoTimelineItem(item) && (clockwiseRotation === 90 || clockwiseRotation === 270)) {
      const temp = width
      width = height
      height = temp
    }

    // === 绘制内容 ===
    // 注意：因为已经 translate 到中心点，所以绘制时要偏移 -width/2, -height/2

    if (TimelineItemQueries.isVideoTimelineItem(item)) {
      const frameData = bunnyCurFrameMap.get(item.id)
      if (frameData) {
        const videoFrame = frameData.videoSample.toVideoFrame()
        // 以中心点为原点绘制
        ctx.drawImage(videoFrame, -width / 2, -height / 2, width, height)
        videoFrame.close()
      }
    } else if (TimelineItemQueries.isTextTimelineItem(item) && item.runtime.textBitmap) {
      // 绘制文本位图
      ctx.drawImage(item.runtime.textBitmap, -width / 2, -height / 2, width, height)
    } else if (TimelineItemQueries.isImageTimelineItem(item)) {
      const mediaItem = getMediaItem(item.mediaItemId)
      const imageClip = mediaItem?.runtime.bunny?.imageClip
      if (imageClip) {
        // 绘制图片
        ctx.drawImage(imageClip, -width / 2, -height / 2, width, height)
      }
    }
  } catch (error) {
    console.error(`❌ 渲染项目失败: ${item.id}`, error)
  } finally {
    // 恢复画布状态（重要！避免影响后续渲染）
    ctx.restore()
  }
}

/**
 * 渲染到 Canvas（专业视频编辑器模式）
 * 使用 item.config 中的所有变换属性进行精确渲染
 *
 * 坐标系统说明：
 * - 画布原点在画布中心 (canvasWidth/2, canvasHeight/2)
 * - config.x, config.y 是相对于画布中心的坐标
 * - 元素原点在元素中心
 *
 * @param renderContext 渲染上下文
 * @param timelineItems 时间轴项目列表
 * @param currentTimeN 当前播放时间（帧数）
 */
export function renderToCanvas(
  renderContext: RenderContext,
  timelineItems: UnifiedTimelineItemData<MediaType>[],
  currentTimeN: number,
): void {
  const { canvas, ctx, bunnyCurFrameMap, getTrack, getMediaItem, trackIndexMap } = renderContext

  // 1. 清空画布
  ctx.clearRect(0, 0, canvas.width, canvas.height)

  // 2. 将画布原点移动到画布中心
  // 这样所有的绘制都基于中心坐标系
  ctx.save()
  ctx.translate(canvas.width / 2, canvas.height / 2)

  // 3. 收集可渲染项目
  const renderableItems = timelineItems.filter((item) => {
    // 检查是否在当前播放时间范围内
    if (
      currentTimeN < item.timeRange.timelineStartTime ||
      currentTimeN > item.timeRange.timelineEndTime
    ) {
      return false
    }

    // 检查轨道是否可见
    const track = item.trackId ? getTrack(item.trackId) : null
    if (track && !track.isVisible) return false

    // 检查是否有可渲染内容
    if (TimelineItemQueries.isVideoTimelineItem(item)) {
      return bunnyCurFrameMap.has(item.id)
    } else if (TimelineItemQueries.isTextTimelineItem(item)) {
      return item.runtime.textBitmap !== undefined
    } else if (TimelineItemQueries.isImageTimelineItem(item)) {
      const mediaItem = getMediaItem(item.mediaItemId)
      return mediaItem?.runtime.bunny?.imageClip !== undefined
    }
    return false
  })

  // 4. 按轨道顺序排序（使用计算属性优化性能）
  // 索引大的先渲染（在下层），索引小的后渲染（在最上层）
  const sortedItems = renderableItems.sort((a, b) => {
    // 获取轨道索引，如果没有 trackId 或找不到则返回 -Infinity（排在最前面）
    const getTrackIndex = (trackId: string | undefined): number => {
      if (!trackId) return -Infinity
      return trackIndexMap.get(trackId) ?? -Infinity
    }

    return getTrackIndex(b.trackId) - getTrackIndex(a.trackId)
  })

  // 5. 渲染每个项目
  for (const item of sortedItems) {
    // 性能优化：跳过完全在画布外的元素
    if (TimelineItemQueries.hasVisualProperties(item)) {
      // ✅ 使用辅助函数获取渲染配置进行边界检查
      const config = TimelineItemQueries.getRenderConfig(item)
      if (!isInBounds(config, canvas.width, canvas.height)) {
        continue
      }
    }
    renderItem(item, ctx, bunnyCurFrameMap, getMediaItem)
  }

  // 6. 恢复画布原点到左上角
  ctx.restore()
}
