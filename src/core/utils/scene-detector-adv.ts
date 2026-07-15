import type { BunnyClip } from '@/core/mediabunny/bunny-clip'
import type { UnifiedTimelineItemData } from '@/core/timelineitem/model/timelineItem'

/**
 * 峰值检测配置（基于 Prominence）
 */
interface PeakDetectionConfig {
  /** 最小 prominence 值（默认 0.03） */
  minProminence?: number
  /** 最小绝对高度（过滤噪声，默认 0.02） */
  minHeight?: number
  /** 峰值之间的最小距离（帧数，默认 1） */
  minDistance?: number
}

/**
 * 峰值信息
 */
interface PeakInfo {
  index: number
  value: number
  prominence: number
  leftBase: number
  rightBase: number
}

/**
 * 场景检测配置（增强版）
 */
interface SceneDetectorAdvConfig {
  /** 峰值检测配置 */
  peakDetection?: PeakDetectionConfig
  /** 帧缩放最大尺寸（默认600） */
  maxSize?: number
  /** 进度回调 */
  onProgress?: (current: number, total: number, message: string) => void
  /** 是否绘制折线图（默认false） */
  enableChart?: boolean
  /** 取消信号 */
  signal?: AbortSignal
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
 * 计算单个峰的 prominence
 * Prominence = 峰值高度 - 左右两侧最高鞍点的高度
 * @param diffs 差异值数组
 * @param peakIdx 峰值索引
 * @returns prominence 信息
 */
function calculateProminence(
  diffs: number[],
  peakIdx: number,
): { prominence: number; leftBase: number; rightBase: number } {
  const peakValue = diffs[peakIdx]

  // 向左搜索：找到比当前峰更高的点或边界，记录路径上的最小值
  let leftMin = peakValue
  let leftBase = peakIdx
  for (let i = peakIdx - 1; i >= 0; i--) {
    if (diffs[i] > peakValue) {
      break
    }
    if (diffs[i] < leftMin) {
      leftMin = diffs[i]
      leftBase = i
    }
  }

  // 向右搜索：找到比当前峰更高的点或边界，记录路径上的最小值
  let rightMin = peakValue
  let rightBase = peakIdx
  for (let i = peakIdx + 1; i < diffs.length; i++) {
    if (diffs[i] > peakValue) {
      break
    }
    if (diffs[i] < rightMin) {
      rightMin = diffs[i]
      rightBase = i
    }
  }

  // Prominence = 峰值 - 两侧鞍点中较高的那个
  const prominence = peakValue - Math.max(leftMin, rightMin)

  return { prominence, leftBase, rightBase }
}

/**
 * 查找所有局部极大值点
 * @param diffs 差异值数组
 * @returns 局部极大值索引数组
 */
function findLocalMaxima(diffs: number[]): number[] {
  const maxima: number[] = []

  for (let i = 1; i < diffs.length - 1; i++) {
    if (diffs[i] > diffs[i - 1] && diffs[i] > diffs[i + 1]) {
      maxima.push(i)
    }
    // 处理平顶峰：连续相等的最大值取中点
    else if (diffs[i] === diffs[i - 1] && diffs[i] > diffs[i + 1]) {
      let start = i - 1
      while (start > 0 && diffs[start] === diffs[start - 1]) {
        start--
      }
      if (diffs[start] > diffs[start - 1]) {
        const mid = Math.floor((start + i) / 2)
        if (!maxima.includes(mid)) {
          maxima.push(mid)
        }
      }
    }
  }

  return maxima
}

/**
 * 基于 Prominence 的峰值检测
 * @param diffs 差异值数组
 * @param config 配置参数
 * @returns 检测到的峰值信息数组
 */
function detectPeaksWithProminence(
  diffs: number[],
  config: PeakDetectionConfig = {},
): PeakInfo[] {
  const minProminence = config.minProminence ?? 0.03
  const minHeight = config.minHeight ?? 0.02
  const minDistance = config.minDistance ?? 1

  // 1. 找到所有局部极大值
  const localMaxima = findLocalMaxima(diffs)

  // 2. 计算每个极大值的 prominence
  const peaks: PeakInfo[] = []

  for (const idx of localMaxima) {
    const value = diffs[idx]

    // 过滤低于最小高度的点
    if (value < minHeight) {
      continue
    }

    const { prominence, leftBase, rightBase } = calculateProminence(diffs, idx)

    // 过滤低于最小 prominence 的点
    if (prominence >= minProminence) {
      peaks.push({
        index: idx,
        value,
        prominence,
        leftBase,
        rightBase,
      })
    }
  }

  // 3. 按 prominence 降序排序，应用最小距离约束
  peaks.sort((a, b) => b.prominence - a.prominence)

  const selectedPeaks: PeakInfo[] = []
  const usedIndices = new Set<number>()

  for (const peak of peaks) {
    // 检查是否与已选峰值距离过近
    let tooClose = false
    for (const used of usedIndices) {
      if (Math.abs(peak.index - used) < minDistance) {
        tooClose = true
        break
      }
    }

    if (!tooClose) {
      selectedPeaks.push(peak)
      usedIndices.add(peak.index)
    }
  }

  // 按索引排序返回
  return selectedPeaks.sort((a, b) => a.index - b.index)
}

/**
 * 检测时间轴项目中的场景分割点（增强版 - 基于 Prominence）
 *
 * @param itemData 时间轴项目数据（包含 timeRange 和 runtime.bunnyClip）
 * @param config 可选配置
 * @returns 分割点帧索引数组（相对于timeRange.timelineStart）
 *
 * @example
 * ```typescript
 * const boundaries = await detectSceneAdv(itemData, {
 *   peakDetection: {
 *     minProminence: 0.03,
 *     minHeight: 0.02,
 *     minDistance: 5
 *   },
 *   maxSize: 600,
 *   onProgress: (current, total, message) => {
 *     console.log(`[${current}/${total}] ${message}`)
 *   }
 * })
 * ```
 */
export async function detectSceneAdv(
  itemData: UnifiedTimelineItemData,
  config: SceneDetectorAdvConfig = {},
): Promise<bigint[]> {
  const bunnyClip = itemData.runtime.bunnyClip
  if (!bunnyClip) {
    throw new Error('BunnyClip不存在')
  }

  // 复制一份 bunnyClip 用于场景检测，避免影响原始实例
  const clonedBunnyClip = bunnyClip.clone()

  const peakDetection = config.peakDetection ?? {}
  const minProminence = peakDetection.minProminence ?? 0.03
  const minHeight = peakDetection.minHeight ?? 0.02
  const minDistance = peakDetection.minDistance ?? 1
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

  reportProgress(0, totalFrames, '开始检测场景分割点（增强版 - Prominence）')

  // 存储分割点
  const boundaries: bigint[] = []

  // 存储所有 diff 值用于峰值检测和绘制折线图
  const diffs: number[] = []

  // 存储帧号，用于将峰值索引转换为实际帧号
  const frameNumbers: bigint[] = []

  // 只需要存储前一帧的直方图，不需要存储整个VideoFrame
  let prevHist: Float32Array | null = null

  try {
    // 遍历所有帧
    for (let frameOffset = 0n; frameOffset < totalFrames; frameOffset++) {
      // 检查取消状态（循环顶部）
      if (config.signal?.aborted) {
        reportProgress(Number(frameOffset), totalFrames, '场景检测已取消')
        return []  // 取消时返回空数组
      }

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

          // 收集所有 diff 值和对应的帧号
          diffs.push(diff)
          frameNumbers.push(currentFrameN)
        }

        // 更新前一帧的直方图
        prevHist = currHist

        // 显示进度
        if (Number(frameOffset) % 30 === 0) {
          reportProgress(Number(frameOffset), totalFrames, `${frameOffset}/${totalFrames}`)
        }
      } finally {
        // 及时释放资源：videoSample、frame
        videoSample.close()
        frame?.close()
      }
    }

    reportProgress(totalFrames, totalFrames, `差异计算完成，开始峰值检测`)

    // 使用 prominence 峰值检测
    const peaks = detectPeaksWithProminence(diffs, {
      minProminence,
      minHeight,
      minDistance,
    })

    // 将峰值转换为帧号
    for (const peak of peaks) {
      boundaries.push(frameNumbers[peak.index])
      reportProgress(
        peak.index,
        diffs.length,
        `检测到分割点: 帧 ${frameNumbers[peak.index]}, ` +
          `差异值: ${peak.value.toFixed(4)}, ` +
          `prominence: ${peak.prominence.toFixed(4)}`,
      )
    }

    reportProgress(totalFrames, totalFrames, `检测完成，共发现 ${boundaries.length} 个分割点`)

    // 绘制折线图（如果启用）
    if (enableChart) {
      drawDiffChart(diffs, peaks, minProminence)
    }

    return boundaries
  } finally {
    // 释放复制的 bunnyClip 资源
    await clonedBunnyClip.dispose()
  }

  /**
   * 绘制 diff 值的折线图（增强版 - 显示 prominence）
   * @param diffs 所有 diff 值数组
   * @param peaks 检测到的峰值信息
   * @param minProminence 最小 prominence 阈值
   */
  function drawDiffChart(diffs: number[], peaks: PeakInfo[], minProminence: number): void {
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
    const maxDiff = Math.max(...diffs)
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

    // 绘制检测到的峰值
    peaks.forEach((peak) => {
      const x = padding + (peak.index / (diffs.length - 1)) * chartWidth
      const y = height - padding - (peak.value / maxDiff) * chartHeight

      // 绘制峰值点
      ctx.beginPath()
      ctx.fillStyle = '#ff0000'
      ctx.arc(x, y, 5, 0, 2 * Math.PI)
      ctx.fill()

      // 绘制 prominence 范围（从峰值到鞍点）
      const leftBaseY = height - padding - (diffs[peak.leftBase] / maxDiff) * chartHeight
      const rightBaseY = height - padding - (diffs[peak.rightBase] / maxDiff) * chartHeight
      const baseY = Math.max(leftBaseY, rightBaseY)

      ctx.beginPath()
      ctx.strokeStyle = '#ff6600'
      ctx.lineWidth = 2
      ctx.setLineDash([3, 3])
      ctx.moveTo(x, y)
      ctx.lineTo(x, baseY)
      ctx.stroke()
      ctx.setLineDash([])

      // 绘制鞍点
      ctx.beginPath()
      ctx.fillStyle = '#ff6600'
      ctx.arc(x, baseY, 3, 0, 2 * Math.PI)
      ctx.fill()
    })

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
    ctx.fillText('场景检测差异值折线图（Prominence 方法）', width / 2, 25)

    // 图例
    ctx.font = '12px Arial'
    ctx.textAlign = 'left'

    // 差异值曲线
    ctx.fillStyle = '#0066cc'
    ctx.fillRect(width - padding - 150, 40, 15, 15)
    ctx.fillStyle = '#333333'
    ctx.fillText('差异值曲线', width - padding - 130, 52)

    // 检测到的峰值
    ctx.fillStyle = '#ff0000'
    ctx.beginPath()
    ctx.arc(width - padding - 143, 65, 5, 0, 2 * Math.PI)
    ctx.fill()
    ctx.fillStyle = '#333333'
    ctx.fillText('检测到的峰值', width - padding - 130, 70)

    // Prominence
    ctx.strokeStyle = '#ff6600'
    ctx.lineWidth = 2
    ctx.setLineDash([3, 3])
    ctx.beginPath()
    ctx.moveTo(width - padding - 150, 85)
    ctx.lineTo(width - padding - 135, 85)
    ctx.stroke()
    ctx.setLineDash([])
    ctx.fillStyle = '#333333'
    ctx.fillText('Prominence', width - padding - 130, 88)

    // 输出到 console
    console.log('场景检测差异值折线图（Prominence 方法）:', canvas)
    console.log('总帧数:', diffs.length)
    console.log('最大差异值:', maxDiff.toFixed(4))
    console.log('最小 Prominence 阈值:', minProminence.toFixed(4))
    console.log('检测到的峰值数:', peaks.length)
    console.log('峰值详情:', peaks)
  }
}