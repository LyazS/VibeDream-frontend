import type { BunnyClip } from '@/core/mediabunny/bunny-clip'
import type { UnifiedTimelineItemData } from '@/core/timelineitem/model/timelineItem'

/**
 * 场景检测配置
 */
interface SceneDetectorConfig {
  /** 分割阈值（0-1之间，默认0.3） */
  threshold?: number
  /** 帧缩放最大尺寸（默认600） */
  maxSize?: number
  /** 进度回调 */
  onProgress?: (current: number, total: number, message: string) => void
  /** 是否绘制折线图（默认false） */
  enableChart?: boolean
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
 * 计算帧的颜色直方图（HSV空间的H和S通道），同时进行缩放优化
 * @param frame 原始视频帧
 * @param maxSize 长边的最大尺寸（默认600）
 * @returns 归一化的直方图数组 [H: 180, S: 256]
 */
function calculateColorHistogram(frame: VideoFrame, maxSize: number = 600): Float32Array {
  const width = frame.displayWidth
  const height = frame.displayHeight

  // 计算缩放比例
  let scale: number
  if (width > height) {
    scale = maxSize / width
  } else {
    scale = maxSize / height
  }

  const newWidth = Math.round(width * scale)
  const newHeight = Math.round(height * scale)

  // 创建离屏Canvas（只创建一次）
  const canvas = new OffscreenCanvas(newWidth, newHeight)
  const ctx = canvas.getContext('2d')

  if (!ctx) {
    throw new Error('无法获取Canvas上下文')
  }

  // 绘制并缩放帧（只绘制一次）
  ctx.drawImage(frame, 0, 0, newWidth, newHeight)

  // 直接获取像素数据
  const imageData = ctx.getImageData(0, 0, newWidth, newHeight)
  const data = imageData.data

  // 初始化直方图
  const histH = new Float32Array(180) // H通道: 0-179
  const histS = new Float32Array(256) // S通道: 0-256

  // 遍历像素计算直方图
  for (let i = 0; i < data.length; i += 4) {
    const r = data[i]
    const g = data[i + 1]
    const b = data[i + 2]

    const [h, s, v] = rgbToHsv(r, g, b)

    histH[h]++
    histS[s]++
  }

  // 归一化
  const totalPixels = data.length / 4
  for (let i = 0; i < 180; i++) {
    histH[i] /= totalPixels
  }
  for (let i = 0; i < 256; i++) {
    histS[i] /= totalPixels
  }

  // 合并直方图
  const hist = new Float32Array(180 + 256)
  hist.set(histH, 0)
  hist.set(histS, 180)

  return hist
}

/**
 * 计算两个直方图之间的差异（使用相关性）
 * @param hist1 第一个直方图
 * @param hist2 第二个直方图
 * @returns 差异值（0-1之间，越大表示差异越大）
 */
function calculateHistogramDiff(hist1: Float32Array, hist2: Float32Array): number {
  if (hist1.length !== hist2.length) {
    throw new Error('直方图长度不一致')
  }

  // 计算均值
  let mean1 = 0
  let mean2 = 0
  for (let i = 0; i < hist1.length; i++) {
    mean1 += hist1[i]
    mean2 += hist2[i]
  }
  mean1 /= hist1.length
  mean2 /= hist2.length

  // 计算相关性
  let numerator = 0
  let denominator1 = 0
  let denominator2 = 0

  for (let i = 0; i < hist1.length; i++) {
    const diff1 = hist1[i] - mean1
    const diff2 = hist2[i] - mean2

    numerator += diff1 * diff2
    denominator1 += diff1 * diff1
    denominator2 += diff2 * diff2
  }

  const denominator = Math.sqrt(denominator1 * denominator2)

  if (denominator === 0) {
    return 0
  }

  const correlation = numerator / denominator

  // 转换为差异值（相关性越高，差异越小）
  return 1.0 - correlation
}

/**
 * 检测时间轴项目中的场景分割点
 *
 * @param itemData 时间轴项目数据（包含 timeRange 和 runtime.bunnyClip）
 * @param config 可选配置
 * @returns 分割点帧索引数组（相对于timeRange.timelineStart）
 *
 * @example
 * ```typescript
 * const boundaries = await detectScene(itemData, {
 *   threshold: 0.3,
 *   maxSize: 600,
 *   onProgress: (current, total, message) => {
 *     console.log(`[${current}/${total}] ${message}`)
 *   }
 * })
 * ```
 */
export async function detectScene(
  itemData: UnifiedTimelineItemData,
  config: SceneDetectorConfig = {},
): Promise<bigint[]> {
  const bunnyClip = itemData.runtime.bunnyClip
  if (!bunnyClip) {
    throw new Error('BunnyClip不存在')
  }

  // 复制一份 bunnyClip 用于场景检测，避免影响原始实例
  const clonedBunnyClip = bunnyClip.clone()

  const threshold = config.threshold ?? 0.3
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

  // 存储所有 diff 值用于绘制折线图
  const diffs: number[] = []

  // 只需要存储前一帧的直方图，不需要存储整个VideoFrame
  let prevHist: Float32Array | null = null

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

        // 直接计算直方图（内部已包含缩放优化，只绘制一次Canvas）
        const currHist = calculateColorHistogram(frame, maxSize)

        // 如果有前一帧，计算差异
        if (prevHist) {
          const diff = calculateHistogramDiff(prevHist, currHist)

          // 收集所有 diff 值
          diffs.push(diff)

          // 检测场景分割
          if (diff > threshold) {
            boundaries.push(currentFrameN)
            reportProgress(
              Number(frameOffset),
              totalFrames,
              `检测到分割点: 帧 ${currentFrameN}, 差异值: ${diff.toFixed(4)}`,
            )
          }
        }

        // 更新前一帧的直方图
        prevHist = currHist

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
      drawDiffChart(diffs, threshold)
    }

    return boundaries
  } finally {
    // 释放复制的 bunnyClip 资源
    await clonedBunnyClip.dispose()
  }

  /**
   * 绘制 diff 值的折线图
   * @param diffs 所有 diff 值数组
   * @param threshold 阈值
   */
  function drawDiffChart(diffs: number[], threshold: number): void {
    const canvas = document.createElement('canvas')
    const padding = 60
    const width = Math.max(800, diffs.length * 2 + padding * 2)
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
    const maxDiff = Math.max(...diffs, threshold)
    const minDiff = 0
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
      const value = minDiff + (maxDiff - minDiff) * (i / ySteps)
      const y = height - padding - (value / maxDiff) * chartHeight

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
    const xSteps = Math.min(10, diffs.length)
    for (let i = 0; i <= xSteps; i++) {
      const index = Math.round((diffs.length - 1) * (i / xSteps))
      const x = padding + (index / (diffs.length - 1)) * chartWidth

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
    const thresholdY = height - padding - (threshold / maxDiff) * chartHeight
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

    diffs.forEach((diff, i) => {
      const x = padding + (i / (diffs.length - 1)) * chartWidth
      const y = height - padding - (diff / maxDiff) * chartHeight

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
    ctx.fillText('差异值', 0, 0)
    ctx.restore()

    // 图表标题
    ctx.font = 'bold 16px Arial'
    ctx.fillText('场景检测差异值折线图', width / 2, 25)

    // 输出到 console
    console.log('场景检测差异值折线图:', canvas)
    console.log('总帧数:', diffs.length)
    console.log('最大差异值:', maxDiff.toFixed(4))
    console.log('阈值:', threshold.toFixed(4))
    console.log('超过阈值的帧数:', diffs.filter(d => d > threshold).length)
  }
}
