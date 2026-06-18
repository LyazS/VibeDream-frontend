import type { BunnyClip } from '@/core/mediabunny/bunny-clip'
import type { UnifiedTimelineItemData } from '@/core/timelineitem/model/timelineItem'

/**
 * 场景检测配置
 */
interface SceneDetectorContentConfig {
  /** 像素强度平均变化必须超过的阈值才能触发切点（默认27.0） */
  threshold?: number
  /** 检测到切点后，必须经过这么多帧才能将新切点添加到场景列表中（默认15） */
  minSceneLen?: number
  /** 计算帧分数时每个组件的权重 */
  weights?: ContentDetectorComponents
  /** 如果为 True，仅考虑视频亮度通道的变化（默认false） */
  lumaOnly?: boolean
  /** 用于扩展检测边缘的核大小。必须是大于等于3的奇数整数。如果为 None，则根据视频分辨率自动设置 */
  kernelSize?: number | null
  /** 用于过滤切点以满足 min_scene_len 的模式（默认MERGE） */
  filterMode?: FlashFilterMode
  /** 视频帧率（默认30.0） */
  fps?: number
  /** 帧缩放最大尺寸（默认600） */
  maxSize?: number
  /** 进度回调 */
  onProgress?: (current: number, total: number, message: string) => void
  /** 是否绘制折线图（默认false） */
  enableChart?: boolean
}

/**
 * 组成帧分数的组件及其默认值
 */
interface ContentDetectorComponents {
  /** 相邻帧的像素色调值差异 */
  deltaHue: number
  /** 相邻帧的像素饱和度值差异 */
  deltaSat: number
  /** 相邻帧的像素亮度值差异 */
  deltaLum: number
  /** 相邻帧的计算边缘差异 */
  deltaEdges: number
}

/**
 * 默认组件权重
 */
const DEFAULT_COMPONENT_WEIGHTS: ContentDetectorComponents = {
  deltaHue: 1.0,
  deltaSat: 1.0,
  deltaLum: 1.0,
  deltaEdges: 0.0,
}

/**
 * 如果设置 luma_only 时使用的组件权重
 */
const LUMA_ONLY_WEIGHTS: ContentDetectorComponents = {
  deltaHue: 0.0,
  deltaSat: 0.0,
  deltaLum: 1.0,
  deltaEdges: 0.0,
}

/**
 * 闪光过滤器的模式
 */
enum FlashFilterMode {
  /** 合并短于过滤长度的连续切点 */
  MERGE = 0,
  /** 抑制连续切点直到过滤长度通过 */
  SUPPRESS = 1,
}

/**
 * RGB转HSV
 * @param r 红色通道 (0-255)
 * @param g 绿色通道 (0-255)
 * @param b 蓝色通道 (0-255)
 * @returns [h, s, v] h: 0-179, s: 0-255, v: 0-255
 */
function rgbToHsv(r: number, g: number, b: number): [number, number, number] {
  r /= 255
  g /= 255
  b /= 255

  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const delta = max - min

  let h = 0
  let s = 0
  const v = max * 255

  if (delta !== 0) {
    s = (delta / max) * 255

    if (max === r) {
      h = 60 * (((g - b) / delta) % 6)
    } else if (max === g) {
      h = 60 * ((b - r) / delta + 2)
    } else {
      h = 60 * ((r - g) / delta + 4)
    }

    if (h < 0) {
      h += 360
    }
  }

  // OpenCV的H范围是0-179，所以需要除以2
  return [Math.round(h / 2), Math.round(s), Math.round(v)]
}

/**
 * 计算两个图像之间的平均像素距离
 * @param left 2D 8位图像数组
 * @param right 2D 8位图像数组，必须与 left 形状相同
 * @returns 平均像素距离
 */
function meanPixelDistance(left: Uint8Array, right: Uint8Array): number {
  if (left.length !== right.length) {
    throw new Error('图像形状不一致')
  }

  let sum = 0
  for (let i = 0; i < left.length; i++) {
    sum += Math.abs(left[i] - right[i])
  }

  return sum / left.length
}

/**
 * 根据视频分辨率估计核大小
 * @param frameWidth 帧宽度
 * @param frameHeight 帧高度
 * @returns 核大小
 */
function estimatedKernelSize(frameWidth: number, frameHeight: number): number {
  let size = 4 + Math.round(Math.sqrt(frameWidth * frameHeight) / 192)
  if (size % 2 === 0) {
    size += 1
  }
  return size
}

/**
 * 给定帧的数据
 */
interface FrameData {
  /** 帧色调图 [2D 8位] */
  hue: Uint8Array
  /** 帧饱和度图 [2D 8位] */
  sat: Uint8Array
  /** 帧亮度图 [2D 8位] */
  lum: Uint8Array
  /** 帧边缘图 [2D 8位，边缘为255，非边缘为0] */
  edges: Uint8Array | null
}

/**
 * 过滤器，用于强制执行最小场景长度
 */
class FlashFilter {
  private _mode: FlashFilterMode
  private _filterLength: number
  private _fps: number
  private _lastAbove: number | null = null
  private _mergeEnabled = false
  private _mergeTriggered = false
  private _mergeStart: number | null = null

  constructor(mode: FlashFilterMode, length: number, fps: number = 30.0) {
    this._mode = mode
    this._filterLength = length
    this._fps = fps
  }

  get maxBehind(): number {
    return this._mode === FlashFilterMode.SUPPRESS ? 0 : this._filterLength
  }

  /**
   * 过滤切点
   * @param frameNum 当前帧号
   * @param aboveThreshold 是否超过阈值
   * @returns 检测到的切点帧号列表
   */
  filter(frameNum: number, aboveThreshold: boolean): number[] {
    if (this._filterLength <= 0) {
      return aboveThreshold ? [frameNum] : []
    }

    if (this._lastAbove === null) {
      this._lastAbove = frameNum
    }

    if (this._mode === FlashFilterMode.MERGE) {
      return this._filterMerge(frameNum, aboveThreshold)
    } else if (this._mode === FlashFilterMode.SUPPRESS) {
      return this._filterSuppress(frameNum, aboveThreshold)
    }

    throw new Error('未处理的 FlashFilter 模式')
  }

  /**
   * 抑制模式过滤
   */
  private _filterSuppress(frameNum: number, aboveThreshold: boolean): number[] {
    const minLengthMet = frameNum - (this._lastAbove ?? 0) >= this._filterLength

    if (!(aboveThreshold && minLengthMet)) {
      return []
    }

    // 同时满足长度和阈值要求。发出切点，并等待两个要求再次满足
    this._lastAbove = frameNum
    return [frameNum]
  }

  /**
   * 合并模式过滤
   */
  private _filterMerge(frameNum: number, aboveThreshold: boolean): number[] {
    const minLengthMet = frameNum - (this._lastAbove ?? 0) >= this._filterLength

    // 确保最后一帧总是推进到最近超过阈值的帧
    if (aboveThreshold) {
      this._lastAbove = frameNum
    }

    if (this._mergeTriggered) {
      // 此帧低于阈值，检查是否通过了足够的帧以禁用过滤器
      const numMergedFrames = (this._lastAbove ?? 0) - (this._mergeStart ?? 0)
      if (
        minLengthMet &&
        !aboveThreshold &&
        numMergedFrames >= this._filterLength
      ) {
        this._mergeTriggered = false
        return [this._lastAbove ?? frameNum]
      }
      // 继续合并，直到有足够的帧低于阈值
      return []
    }

    // 等待下一个超过阈值的帧
    if (!aboveThreshold) {
      return []
    }

    // 如果满足最小长度要求，则无需合并
    if (minLengthMet) {
      // 只允许在发出第一个切点后使用合并过滤器
      this._mergeEnabled = true
      return [frameNum]
    }

    // 开始合并切点，直到满足长度要求
    if (this._mergeEnabled) {
      this._mergeTriggered = true
      this._mergeStart = frameNum
    }

    return []
  }
}

/**
 * 使用帧间颜色和亮度变化检测快速切点
 * 差异在 HSV 颜色空间中计算，并与设定的阈值比较以确定何时发生快速切点
 */
class ContentDetector {
  private _threshold: number
  private _lastAboveThreshold: number | null = null
  private _lastFrame: FrameData | null = null
  private _weights: ContentDetectorComponents
  private _fps: number
  private _kernel: number | null = null
  private _frameScore: number | null = null
  private _flashFilter: FlashFilter
  private _maxSize: number

  constructor(
    threshold: number = 27.0,
    minSceneLen: number = 15,
    weights: ContentDetectorComponents = DEFAULT_COMPONENT_WEIGHTS,
    lumaOnly: boolean = false,
    kernelSize: number | null = null,
    filterMode: FlashFilterMode = FlashFilterMode.MERGE,
    fps: number = 30.0,
    maxSize: number = 600,
  ) {
    this._threshold = threshold
    this._weights = weights
    this._fps = fps
    this._maxSize = maxSize

    if (lumaOnly) {
      this._weights = LUMA_ONLY_WEIGHTS
    }

    if (kernelSize !== null) {
      if (kernelSize < 3 || kernelSize % 2 === 0) {
        throw new Error('kernel_size 必须是大于等于3的奇数整数')
      }
      this._kernel = kernelSize
    }

    this._flashFilter = new FlashFilter(filterMode, minSceneLen, fps)
  }

  /**
   * 处理下一帧
   * @param frameNum 正在处理的帧号
   * @param frameImg 对应的视频帧
   * @returns 检测到场景切点的帧号列表
   */
  processFrame(frameNum: number, frameImg: VideoFrame): number[] {
    this._frameScore = this._calculateFrameScore(frameNum, frameImg)
    if (this._frameScore === null) {
      return []
    }

    const aboveThreshold = this._frameScore >= this._threshold
    return this._flashFilter.filter(frameNum, aboveThreshold)
  }

  /**
   * 计算表示 frame_img 中相对运动量的分数
   * 与上次调用该函数时相比（第一次调用返回 0.0）
   */
  private _calculateFrameScore(frameNum: number, frameImg: VideoFrame): number {
    // 获取帧数据并转换为 HSV
    const { hue, sat, lum } = this._convertFrameToHsv(frameImg)

    // 性能优化：仅在需要时计算边缘
    const calculateEdges = this._weights.deltaEdges > 0.0
    const edges = calculateEdges ? this._detectEdges(lum, frameImg.displayWidth, frameImg.displayHeight) : null

    if (this._lastFrame === null) {
      // 需要另一帧进行比较以计算分数
      this._lastFrame = { hue, sat, lum, edges }
      return 0.0
    }

    const scoreComponents: ContentDetectorComponents = {
      deltaHue: meanPixelDistance(hue, this._lastFrame.hue),
      deltaSat: meanPixelDistance(sat, this._lastFrame.sat),
      deltaLum: meanPixelDistance(lum, this._lastFrame.lum),
      deltaEdges: edges === null ? 0.0 : meanPixelDistance(edges, this._lastFrame.edges!),
    }

    const frameScore =
      (scoreComponents.deltaHue * this._weights.deltaHue +
        scoreComponents.deltaSat * this._weights.deltaSat +
        scoreComponents.deltaLum * this._weights.deltaLum +
        scoreComponents.deltaEdges * this._weights.deltaEdges) /
      (Math.abs(this._weights.deltaHue) +
        Math.abs(this._weights.deltaSat) +
        Math.abs(this._weights.deltaLum) +
        Math.abs(this._weights.deltaEdges))

    // 存储计算下一帧分数所需的所有数据
    this._lastFrame = { hue, sat, lum, edges }
    return frameScore
  }

  /**
   * 将视频帧转换为 HSV 颜色空间
   */
  private _convertFrameToHsv(frame: VideoFrame): { hue: Uint8Array; sat: Uint8Array; lum: Uint8Array } {
    const width = frame.displayWidth
    const height = frame.displayHeight

    // 计算缩放比例
    let scale: number
    if (width > height) {
      scale = this._maxSize / width
    } else {
      scale = this._maxSize / height
    }

    const newWidth = Math.round(width * scale)
    const newHeight = Math.round(height * scale)

    // 创建离屏Canvas
    const canvas = new OffscreenCanvas(newWidth, newHeight)
    const ctx = canvas.getContext('2d')

    if (!ctx) {
      throw new Error('无法获取Canvas上下文')
    }

    // 绘制并缩放帧
    ctx.drawImage(frame, 0, 0, newWidth, newHeight)

    // 获取像素数据
    const imageData = ctx.getImageData(0, 0, newWidth, newHeight)
    const data = imageData.data

    // 初始化 HSV 通道
    const hue = new Uint8Array(newWidth * newHeight)
    const sat = new Uint8Array(newWidth * newHeight)
    const lum = new Uint8Array(newWidth * newHeight)

    // 遍历像素计算 HSV
    for (let i = 0; i < data.length; i += 4) {
      const r = data[i]
      const g = data[i + 1]
      const b = data[i + 2]

      const [h, s, v] = rgbToHsv(r, g, b)

      hue[i / 4] = h
      sat[i / 4] = s
      lum[i / 4] = v
    }

    return { hue, sat, lum }
  }

  /**
   * 使用帧的亮度通道检测边缘
   * @param lum 表示帧亮度通道的 2D 8位图像
   * @param width 帧宽度
   * @param height 帧高度
   * @returns 与输入大小相同的 2D 8位图像，其中值为 255 的像素表示边缘，其他所有像素为 0
   */
  private _detectEdges(lum: Uint8Array, width: number, height: number): Uint8Array {
    // 初始化核
    let kernelSize = this._kernel
    if (kernelSize === null) {
      kernelSize = estimatedKernelSize(width, height)
    }

    // 估计阈值级别
    const sigma = 1.0 / 3.0
    const median = this._calculateMedian(lum)
    const low = Math.max(0, (1.0 - sigma) * median)
    const high = Math.min(255, (1.0 + sigma) * median)

    // 使用简化的 Canny 算法计算边缘
    const edges = this._cannyEdgeDetection(lum, width, height, low, high)

    // 膨胀边缘
    return this._dilate(edges, width, height, kernelSize)
  }

  /**
   * 计算数组的中位数
   */
  private _calculateMedian(arr: Uint8Array): number {
    const sorted = Array.from(arr).sort((a, b) => a - b)
    const mid = Math.floor(sorted.length / 2)
    return sorted.length % 2 !== 0 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
  }

  /**
   * 简化的 Canny 边缘检测
   */
  private _cannyEdgeDetection(
    lum: Uint8Array,
    width: number,
    height: number,
    low: number,
    high: number,
  ): Uint8Array {
    const edges = new Uint8Array(width * height)

    // 使用 Sobel 算子计算梯度
    for (let y = 1; y < height - 1; y++) {
      for (let x = 1; x < width - 1; x++) {
        const idx = y * width + x

        // Sobel X
        const gx =
          -1 * lum[idx - width - 1] +
          1 * lum[idx - width + 1] +
          -2 * lum[idx - 1] +
          2 * lum[idx + 1] +
          -1 * lum[idx + width - 1] +
          1 * lum[idx + width + 1]

        // Sobel Y
        const gy =
          -1 * lum[idx - width - 1] +
          -2 * lum[idx - width] +
          -1 * lum[idx - width + 1] +
          1 * lum[idx + width - 1] +
          2 * lum[idx + width] +
          1 * lum[idx + width + 1]

        const magnitude = Math.sqrt(gx * gx + gy * gy)

        // 双阈值检测
        if (magnitude >= high) {
          edges[idx] = 255
        } else if (magnitude >= low) {
          edges[idx] = 128
        }
      }
    }

    return edges
  }

  /**
   * 膨胀操作
   */
  private _dilate(
    edges: Uint8Array,
    width: number,
    height: number,
    kernelSize: number,
  ): Uint8Array {
    const result = new Uint8Array(width * height)
    const halfKernel = Math.floor(kernelSize / 2)

    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const idx = y * width + x
        let maxVal = 0

        for (let ky = -halfKernel; ky <= halfKernel; ky++) {
          for (let kx = -halfKernel; kx <= halfKernel; kx++) {
            const ny = y + ky
            const nx = x + kx

            if (ny >= 0 && ny < height && nx >= 0 && nx < width) {
              const nidx = ny * width + nx
              if (edges[nidx] > maxVal) {
                maxVal = edges[nidx]
              }
            }
          }
        }

        result[idx] = maxVal
      }
    }

    return result
  }

  get eventBufferLength(): number {
    return this._flashFilter.maxBehind
  }

  get frameScore(): number | null {
    return this._frameScore
  }
}

/**
 * 检测时间轴项目中的场景分割点（使用 ContentDetector）
 *
 * @param itemData 时间轴项目数据（包含 timeRange 和 runtime.bunnyClip）
 * @param config 可选配置
 * @returns 分割点帧索引数组（相对于timeRange.timelineStart）
 *
 * @example
 * ```typescript
 * const boundaries = await detectSceneContent(itemData, {
 *   threshold: 27.0,
 *   minSceneLen: 15,
 *   maxSize: 600,
 *   onProgress: (current, total, message) => {
 *     console.log(`[${current}/${total}] ${message}`)
 *   }
 * })
 * ```
 */
export async function detectSceneContent(
  itemData: UnifiedTimelineItemData,
  config: SceneDetectorContentConfig = {},
): Promise<bigint[]> {
  const bunnyClip = itemData.runtime.bunnyClip
  if (!bunnyClip) {
    throw new Error('BunnyClip不存在')
  }

  // 复制一份 bunnyClip 用于场景检测，避免影响原始实例
  const clonedBunnyClip = bunnyClip.clone()

  const threshold = config.threshold ?? 27.0
  const minSceneLen = config.minSceneLen ?? 15
  const weights = config.weights ?? DEFAULT_COMPONENT_WEIGHTS
  const lumaOnly = config.lumaOnly ?? false
  const kernelSize = config.kernelSize ?? null
  const filterMode = config.filterMode ?? FlashFilterMode.MERGE
  const fps = config.fps ?? 30.0
  const maxSize = config.maxSize ?? 600
  const onProgress = config.onProgress
  const enableChart = config.enableChart ?? false

  // 获取时间范围
  const timeRange = itemData.timeRange
  const startFrame = BigInt(timeRange.timelineStartTime)
  const endFrame = BigInt(timeRange.timelineEndTime)
  const totalFrames = Number(endFrame - startFrame)

  const reportProgress = (current: number, total: number, message: string) => {
    if (onProgress) {
      onProgress(current, total, message)
    }
  }

  reportProgress(0, totalFrames, '开始检测场景分割点')

  // 存储分割点
  const boundaries: bigint[] = []

  // 存储所有 score 值用于绘制折线图
  const scores: number[] = []

  // 创建检测器
  const detector = new ContentDetector(
    threshold,
    minSceneLen,
    weights,
    lumaOnly,
    kernelSize,
    filterMode,
    fps,
    maxSize,
  )

  try {
    // 遍历所有帧
    for (let frameOffset = 0n; frameOffset < totalFrames; frameOffset++) {
      const currentFrameN = startFrame + frameOffset

      // 获取当前帧
      const result = await clonedBunnyClip.tickN(currentFrameN, false, true)
      const videoSample = result.video

      if (!videoSample) {
        reportProgress(Number(frameOffset), totalFrames, `跳过帧 ${currentFrameN}`)
        continue
      }

      let frame: VideoFrame | null = null

      try {
        // 转换为VideoFrame
        frame = await videoSample.toVideoFrame()

        // 处理帧
        const cuts = detector.processFrame(Number(currentFrameN), frame)

        // 收集所有 score 值
        if (detector.frameScore !== null) {
          scores.push(detector.frameScore)
        }

        // 如果检测到切点，记录下来
        if (cuts.length > 0) {
          for (const cut of cuts) {
            boundaries.push(BigInt(cut))
            reportProgress(
              Number(frameOffset),
              totalFrames,
              `检测到分割点: 帧 ${cut}, 分数: ${detector.frameScore?.toFixed(2)}`,
            )
          }
        }

        // 显示进度
        if (Number(frameOffset) % 30 === 0) {
          reportProgress(Number(frameOffset), totalFrames, `已处理 ${frameOffset}/${totalFrames} 帧`)
        }
      } finally {
        // 及时释放资源：videoSample、frame
        videoSample.close()
        frame?.close()
      }
    }

    reportProgress(totalFrames, totalFrames, `检测完成，共发现 ${boundaries.length} 个分割点`)

    // 绘制折线图（如果启用）
    if (enableChart) {
      drawScoreChart(scores, threshold)
    }

    return boundaries
  } finally {
    // 释放复制的 bunnyClip 资源
    await clonedBunnyClip.dispose()
  }

  /**
   * 绘制 score 值的折线图
   * @param scores 所有 score 值数组
   * @param threshold 阈值
   */
  function drawScoreChart(scores: number[], threshold: number): void {
    const canvas = document.createElement('canvas')
    const padding = 60
    const width = Math.max(800, scores.length * 2 + padding * 2)
    const height = 400

    canvas.width = width
    canvas.height = height
    document.body.appendChild(canvas)

    const ctx = canvas.getContext('2d')
    if (!ctx) {
      console.error('无法获取 Canvas 上下文')
      return
    }

    // 清空画布
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, width, height)

    // 计算数据范围
    const maxScore = Math.max(...scores, threshold)
    const minScore = 0
    const chartWidth = width - padding * 2
    const chartHeight = height - padding * 2

    // 绘制坐标轴
    ctx.strokeStyle = '#333333'
    ctx.lineWidth = 2
    ctx.beginPath()

    // Y轴
    ctx.moveTo(padding, padding)
    ctx.lineTo(padding, height - padding)

    // X轴
    ctx.lineTo(width - padding, height - padding)
    ctx.stroke()

    // 绘制 Y 轴刻度和标签
    ctx.fillStyle = '#333333'
    ctx.font = '12px Arial'
    ctx.textAlign = 'right'
    ctx.textBaseline = 'middle'

    const ySteps = 5
    for (let i = 0; i <= ySteps; i++) {
      const value = minScore + (maxScore - minScore) * (i / ySteps)
      const y = height - padding - (value / maxScore) * chartHeight

      // 刻度线
      ctx.beginPath()
      ctx.strokeStyle = '#cccccc'
      ctx.lineWidth = 1
      ctx.moveTo(padding, y)
      ctx.lineTo(width - padding, y)
      ctx.stroke()

      // 标签
      ctx.fillText(value.toFixed(2), padding - 10, y)
    }

    // 绘制 X 轴刻度和标签
    ctx.textAlign = 'center'
    ctx.textBaseline = 'top'
    const xSteps = Math.min(10, scores.length)
    for (let i = 0; i <= xSteps; i++) {
      const index = Math.round((scores.length - 1) * (i / xSteps))
      const x = padding + (index / (scores.length - 1)) * chartWidth

      // 刻度线
      ctx.beginPath()
      ctx.strokeStyle = '#cccccc'
      ctx.lineWidth = 1
      ctx.moveTo(x, height - padding)
      ctx.lineTo(x, height - padding + 5)
      ctx.stroke()

      // 标签
      ctx.fillText(index.toString(), x, height - padding + 10)
    }

    // 绘制阈值线
    const thresholdY = height - padding - (threshold / maxScore) * chartHeight
    ctx.beginPath()
    ctx.strokeStyle = '#ff0000'
    ctx.lineWidth = 2
    ctx.setLineDash([5, 5])
    ctx.moveTo(padding, thresholdY)
    ctx.lineTo(width - padding, thresholdY)
    ctx.stroke()
    ctx.setLineDash([])

    // 阈值标签
    ctx.fillStyle = '#ff0000'
    ctx.textAlign = 'left'
    ctx.fillText(`阈值: ${threshold.toFixed(2)}`, width - padding - 80, thresholdY - 10)

    // 绘制折线
    ctx.beginPath()
    ctx.strokeStyle = '#0066cc'
    ctx.lineWidth = 2

    scores.forEach((score, i) => {
      const x = padding + (i / (scores.length - 1)) * chartWidth
      const y = height - padding - (score / maxScore) * chartHeight

      if (i === 0) {
        ctx.moveTo(x, y)
      } else {
        ctx.lineTo(x, y)
      }
    })
    ctx.stroke()

    // 绘制坐标轴标题
    ctx.fillStyle = '#333333'
    ctx.font = 'bold 14px Arial'
    ctx.textAlign = 'center'

    // X轴标题
    ctx.fillText('帧索引', width / 2, height - 15)

    // Y轴标题
    ctx.save()
    ctx.translate(15, height / 2)
    ctx.rotate(-Math.PI / 2)
    ctx.fillText('分数', 0, 0)
    ctx.restore()

    // 图表标题
    ctx.font = 'bold 16px Arial'
    ctx.fillText('场景检测分数折线图 (ContentDetector)', width / 2, 25)

    // 输出到 console
    console.log('场景检测分数折线图:', canvas)
    console.log('总帧数:', scores.length)
    console.log('最大分数:', maxScore.toFixed(4))
    console.log('阈值:', threshold.toFixed(4))
    console.log('超过阈值的帧数:', scores.filter(s => s > threshold).length)
  }
}