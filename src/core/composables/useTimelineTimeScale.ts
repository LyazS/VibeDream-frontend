import { ref, computed, type Ref } from 'vue'
import { useUnifiedStore } from '@/core/unifiedStore'
import { calculateVisibleFrameRange } from '@/core/utils/timelineScaleUtils'
import { framesToTimecode } from '@/core/utils/timeUtils'
import type { SnapPoint } from '@/types/snap'
import { useTimelineWheelHandler, TimelineWheelSource } from './useTimelineWheelHandler'

/**
 * 时间刻度层级接口
 */
interface TimeScaleLevel {
  level: number // 层级编号
  majorInterval: number // 主刻度间隔（帧数）
  minorInterval: number // 次刻度间隔（帧数）
  unit: 'minutes' | 'seconds' | 'frames' // 单位类型
  displayName: string // 显示名称
}

/**
 * 时间刻度层级配置
 * 按照设计文档定义15个层级
 */
const TIME_SCALE_LEVELS: TimeScaleLevel[] = [
  // 分钟级别 - 每个主刻度间隔有10个次刻度间隔
  { level: 1, majorInterval: 54000, minorInterval: 5400, unit: 'minutes', displayName: '30分钟' }, // 30分钟/3分钟
  { level: 2, majorInterval: 18000, minorInterval: 1800, unit: 'minutes', displayName: '10分钟' }, // 10分钟/1分钟
  { level: 3, majorInterval: 9000, minorInterval: 900, unit: 'minutes', displayName: '5分钟' }, // 5分钟/0.5分钟
  { level: 4, majorInterval: 5400, minorInterval: 540, unit: 'minutes', displayName: '3分钟' }, // 3分钟/0.3分钟
  { level: 5, majorInterval: 3600, minorInterval: 360, unit: 'minutes', displayName: '2分钟' }, // 2分钟/0.2分钟
  { level: 6, majorInterval: 1800, minorInterval: 180, unit: 'minutes', displayName: '1分钟' }, // 1分钟/0.1分钟

  // 秒级别 - 每个主刻度间隔有10个次刻度间隔
  { level: 7, majorInterval: 900, minorInterval: 90, unit: 'seconds', displayName: '30秒' }, // 30秒/3秒
  { level: 8, majorInterval: 300, minorInterval: 30, unit: 'seconds', displayName: '10秒' }, // 10秒/1秒
  { level: 9, majorInterval: 150, minorInterval: 15, unit: 'seconds', displayName: '5秒' }, // 5秒/0.5秒
  { level: 10, majorInterval: 90, minorInterval: 9, unit: 'seconds', displayName: '3秒' }, // 3秒/0.3秒
  { level: 11, majorInterval: 60, minorInterval: 6, unit: 'seconds', displayName: '2秒' }, // 2秒/0.2秒
  { level: 12, majorInterval: 30, minorInterval: 3, unit: 'seconds', displayName: '1秒' }, // 1秒/0.1秒

  // 帧级别 - 保持不变
  { level: 13, majorInterval: 15, minorInterval: 3, unit: 'frames', displayName: '15帧' }, // 15帧/5帧
  { level: 14, majorInterval: 10, minorInterval: 2, unit: 'frames', displayName: '10帧' }, // 10帧/5帧
  { level: 15, majorInterval: 5, minorInterval: 1, unit: 'frames', displayName: '5帧' }, // 5帧/1帧
]

/**
 * 计算刻度间隔
 * 根据设计文档的固定像素间隔原则计算主次刻度的像素间隔
 * 使用数学计算直接确定最优层级，避免 while 循环
 */
function calculateScaleIntervals(
  containerWidth: number,
  totalDurationFrames: number,
  zoomLevel: number,
): {
  currentLevel: TimeScaleLevel
  majorIntervalPixels: number
  minorIntervalPixels: number
} {
  const pixelsPerFrame = (containerWidth * zoomLevel) / totalDurationFrames

  // 计算理想的主刻度间隔（帧数），目标150px（100-200px范围的中间值）
  const idealMajorIntervalFrames = 150 / pixelsPerFrame

  // 找到最接近理想间隔的层级
  let bestIndex = 0
  let minDiff = Infinity

  for (let i = 0; i < TIME_SCALE_LEVELS.length; i++) {
    const level = TIME_SCALE_LEVELS[i]
    const diff = Math.abs(level.majorInterval - idealMajorIntervalFrames)
    if (diff < minDiff) {
      minDiff = diff
      bestIndex = i
    }
  }

  const currentLevel = TIME_SCALE_LEVELS[bestIndex]
  const majorIntervalPixels = currentLevel.majorInterval * pixelsPerFrame
  const minorIntervalPixels = currentLevel.minorInterval * pixelsPerFrame

  return {
    currentLevel,
    majorIntervalPixels,
    minorIntervalPixels,
  }
}
/**
 * 时间刻度标记接口
 * 用于时间轴刻度显示
 */
interface TimeMark {
  time: number // 时间值（帧数）- 内部使用帧数进行精确计算
  position: number
  isMajor: boolean
  isFrame?: boolean // 标记是否为帧级别的刻度
}

/**
 * 时间轴时间刻度模块
 * 提供时间轴时间刻度相关的功能，包括刻度标记计算、事件处理等
 */
export function useTimelineTimeScale(scaleContainer: Ref<HTMLElement | undefined>) {
  const unifiedStore = useUnifiedStore()

  // 直接使用统一存储中的容器宽度

  // 拖拽状态
  const isDragging = ref(false)

  // 当前吸附结果
  const currentSnapResult = ref<{
    snapped: boolean
    frame: number
    snapPoint?: SnapPoint
    distance?: number
  } | null>(null)

  // 缓存的刻度间隔计算结果 - 使用 timelineWidth（不包含轨道控制区域）
  const scaleIntervals = computed(() => {
    return calculateScaleIntervals(
      unifiedStore.TimelineContentWidth,
      unifiedStore.totalDurationFrames,
      unifiedStore.zoomLevel,
    )
  })

  /**
   * 计算时间刻度标记（基于帧数）
   * 使用新的层级系统实现固定像素间隔
   */
  const timeMarks = computed((): TimeMark[] => {
    const marks: TimeMark[] = []
    const { currentLevel, majorIntervalPixels, minorIntervalPixels } = scaleIntervals.value

    // 计算可见帧数范围 - 使用 timelineWidth（不包含轨道控制区域）
    const { startFrames, endFrames } = calculateVisibleFrameRange(
      unifiedStore.TimelineContentWidth,
      unifiedStore.totalDurationFrames,
      unifiedStore.zoomLevel,
      unifiedStore.scrollOffset,
      unifiedStore.maxVisibleDurationFrames,
    )

    // 对齐到刻度间隔
    const alignedStart =
      Math.floor(startFrames / currentLevel.minorInterval) * currentLevel.minorInterval
    const alignedEnd =
      Math.ceil(endFrames / currentLevel.minorInterval) * currentLevel.minorInterval

    // 生成刻度标记
    for (let frames = alignedStart; frames <= alignedEnd; frames += currentLevel.minorInterval) {
      if (frames < 0) continue

      const isMajor = frames % currentLevel.majorInterval === 0
      const position = unifiedStore.frameToPixel(frames, unifiedStore.TimelineContentWidth)

      // 只添加可见范围内的刻度（扩增可见范围）
      if (position >= -50 && position <= unifiedStore.TimelineContentWidth + 50) {
        marks.push({
          time: frames,
          position,
          isMajor,
          isFrame: currentLevel.unit === 'frames',
        })
      }
    }

    return marks
  })

  /**
   * 格式化时间显示
   * 根据当前层级显示不同的时间格式
   * 如果小时为0则不显示小时部分，但分钟总是显示
   */
  function formatTime(frames: number): string {
    const { currentLevel } = scaleIntervals.value

    const totalSeconds = Math.floor(frames / 30) // 假设30fps

    const hours = Math.floor(totalSeconds / 3600)
    const minutes = Math.floor((totalSeconds % 3600) / 60)
    const seconds = totalSeconds % 60
    const remainingFrames = frames % 30

    // 格式化数字为两位数
    const formatNumber = (num: number) => num.toString().padStart(2, '0')

    // 根据单位类型决定要显示的时间部分
    const timeParts: string[] = []

    // 如果有小时且小时不为0，在分钟前面添加小时
    if (hours > 0) {
      timeParts.push(formatNumber(hours))
      timeParts.push(':')
    }
    // 总是显示分+秒
    timeParts.push(formatNumber(minutes))
    timeParts.push(':')
    timeParts.push(formatNumber(seconds))

    // 如果有帧数，在秒前面添加帧数
    if (currentLevel.unit === 'frames') {
      timeParts.push('.')
      timeParts.push(formatNumber(remainingFrames))
      timeParts.push('f')
    }

    // 将数组中的所有元素连接成一个字符串
    return timeParts.join('')
  }

  /**
   * 更新容器宽度
   * 注意：scaleContainer 是 timeline-scale 元素，它的宽度已经不包含轨道控制区域
   * 所以需要加上 TRACK_CONTROL_WIDTH 才是完整的 containerWidth
   */
  function updateContainerWidth() {
    if (scaleContainer.value) {
      const timelineScaleWidth = scaleContainer.value.clientWidth
      // containerWidth = 轨道控制区域宽度 + 时间刻度区域宽度
      unifiedStore.setContainerWidth(timelineScaleWidth + 150) // 150 是 TRACK_CONTROL_WIDTH
    }
  }

  /**
   * 计算点击位置对应的帧数
   * 注意：时间刻度区域的宽度应该使用 timelineWidth（不包含轨道控制区域）
   */
  function calculateFrameFromClick(event: MouseEvent): number {
    if (!scaleContainer.value) return 0

    const rect = scaleContainer.value.getBoundingClientRect()
    const clickX = event.clientX - rect.left
    return unifiedStore.pixelToFrame(clickX, unifiedStore.TimelineContentWidth)
  }

  /**
   * 计算全局鼠标位置对应的帧数
   * 注意：时间刻度区域的宽度应该使用 timelineWidth（不包含轨道控制区域）
   */
  function calculateFrameFromGlobalMouse(event: MouseEvent): number {
    if (!scaleContainer.value) return 0

    const rect = scaleContainer.value.getBoundingClientRect()
    // 限制鼠标X坐标在刻度容器范围内
    const clampedX = Math.max(rect.left, Math.min(event.clientX, rect.right))
    const clickX = clampedX - rect.left
    return unifiedStore.pixelToFrame(clickX, unifiedStore.TimelineContentWidth)
  }

  /**
   * 处理时间刻度区域的点击事件
   */
  function handleTimeScaleClick(event: MouseEvent) {
    const frame = calculateFrameFromClick(event)
    unifiedStore.setCurrentFrame(Math.round(frame))
  }

  /**
   * 处理时间刻度区域的鼠标按下事件
   */
  function handleTimeScaleMouseDown(event: MouseEvent) {
    // 阻止默认行为，防止文本选择
    event.preventDefault()

    unifiedStore.pause()

    // 开始拖拽，设置拖拽状态
    isDragging.value = true
    const frame = calculateFrameFromClick(event)
    unifiedStore.setCurrentFrame(Math.round(frame))

    // 添加全局鼠标事件监听器，处理拖拽到区域外的情况
    document.addEventListener('mousemove', handleGlobalMouseMove)
    document.addEventListener('mouseup', handleGlobalMouseUp)
  }

  /**
   * 处理全局鼠标移动事件
   */
  function handleGlobalMouseMove(event: MouseEvent) {
    if (isDragging.value) {
      let frame = calculateFrameFromGlobalMouse(event)

      // 应用吸附功能到时间刻度拖拽
      if (unifiedStore.snapConfig.enabled && unifiedStore.snapConfig.playhead) {
        // 开始拖拽阶段，收集候选目标
        if (!unifiedStore.isSnapCalculating) {
          unifiedStore.startSnapDrag([])
        }

        // 计算吸附位置
        const snapOptions = {
          excludeClipIds: [],
          customThreshold: unifiedStore.snapConfig.threshold,
        }
        const calculatedSnapResult = unifiedStore.calculateSnapPosition(frame, snapOptions)
        if (calculatedSnapResult) {
          // 避免吸附到播放头自身位置
          const isSnappingToCurrentPlayhead = calculatedSnapResult.snapPoint?.type === 'playhead'
          if (!isSnappingToCurrentPlayhead) {
            frame = calculatedSnapResult.frame
          }
        }
      }

      unifiedStore.setCurrentFrame(Math.round(frame))
    }
  }

  /**
   * 处理全局鼠标释放事件
   */
  function handleGlobalMouseUp() {
    // 结束拖拽
    isDragging.value = false

    // 移除全局事件监听器
    document.removeEventListener('mousemove', handleGlobalMouseMove)
    document.removeEventListener('mouseup', handleGlobalMouseUp)

    // 清理吸附状态
    if (unifiedStore.snapConfig.enabled && unifiedStore.snapConfig.playhead) {
      unifiedStore.endSnapDrag()
    }

    // 清理吸附结果
    currentSnapResult.value = null
  }

  /**
   * 处理时间刻度区域的鼠标移动事件
   */
  function handleTimeScaleMouseMove(event: MouseEvent) {
    if (isDragging.value) {
      let frame = calculateFrameFromClick(event)

      // 应用吸附功能到时间刻度拖拽
      if (unifiedStore.snapConfig.enabled && unifiedStore.snapConfig.playhead) {
        // 计算吸附位置
        const snapOptions = {
          excludeClipIds: [],
          customThreshold: unifiedStore.snapConfig.threshold,
        }
        const calculatedSnapResult = unifiedStore.calculateSnapPosition(frame, snapOptions)
        if (calculatedSnapResult) {
          // 避免吸附到播放头自身位置
          const isSnappingToCurrentPlayhead = calculatedSnapResult.snapPoint?.type === 'playhead'
          if (!isSnappingToCurrentPlayhead) {
            frame = calculatedSnapResult.frame
          }
        }
      }

      unifiedStore.setCurrentFrame(Math.round(frame))
    }
  }

  /**
   * 处理时间刻度区域的鼠标释放事件
   */
  function handleTimeScaleMouseUp() {
    handleGlobalMouseUp()
  }

  // 使用统一的滚轮处理
  const { handleWheel: handleTimeScaleWheel } = useTimelineWheelHandler(scaleContainer, {
    source: TimelineWheelSource.TIME_SCALE, // 时间刻度区域
  })

  return {
    // 状态
    isDragging,
    currentSnapResult,

    // 计算属性
    timeMarks,

    // 方法
    formatTime,
    updateContainerWidth,
    calculateFrameFromClick,
    handleTimeScaleClick,
    handleTimeScaleMouseDown,
    handleTimeScaleMouseMove,
    handleTimeScaleMouseUp,
    handleTimeScaleWheel,
  }
}
