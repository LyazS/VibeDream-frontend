import type { UnifiedTimelineItemData } from '@/core/timelineitem/type'
import type { OnnxModelLoadProgress } from '@/core/onnx'
import { probabilitiesToTimelineCutFrames } from './transnetv2/cutPostprocess'
import { loadTransNetV2Runner } from './transnetv2/modelRunner'
import { createTransNetV2Window, TransNetV2Preprocessor } from './transnetv2/preprocessing'
import {
  TRANSNETV2_DEFAULT_MIN_SHOT_FRAMES,
  TRANSNETV2_DEFAULT_THRESHOLD,
  TRANSNETV2_INPUT_CHANNELS,
  TRANSNETV2_INPUT_HEIGHT,
  TRANSNETV2_INPUT_WIDTH,
  TRANSNETV2_WINDOW_SIZE,
  type TransNetV2DetectorConfig,
  type TransNetV2ProgressEvent,
} from './transnetv2/types'

const MODEL_LOADING_PROGRESS_END = 20
const FRAME_ANALYSIS_PROGRESS_END = 95
const POSTPROCESS_PROGRESS = 98

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw new DOMException('场景检测已取消', 'AbortError')
  }
}

function reportProgress(
  onProgress: TransNetV2DetectorConfig['onProgress'],
  event: TransNetV2ProgressEvent,
): void {
  onProgress?.(event)
}

function reportModelLoadProgress(
  onProgress: TransNetV2DetectorConfig['onProgress'],
  progress: OnnxModelLoadProgress,
): void {
  let current = 0
  let stage: TransNetV2ProgressEvent['stage'] = 'loading-model'

  switch (progress.stage) {
    case 'checking-cache':
      current = 2
      stage = 'checking-cache'
      break
    case 'loading-from-cache':
      current = 8
      stage = 'loading-from-cache'
      break
    case 'downloading-model':
      current = Math.round((progress.progress ?? 0) * (MODEL_LOADING_PROGRESS_END - 4)) + 4
      stage = 'downloading-model'
      break
    case 'initializing-session':
      current = 18
      stage = 'initializing-model'
      break
    case 'ready':
      current = MODEL_LOADING_PROGRESS_END
      stage = 'model-ready'
      break
  }

  reportProgress(onProgress, {
    current,
    total: 100,
    stage,
    progress: progress.progress,
    loadedBytes: progress.loadedBytes,
    totalBytes: progress.totalBytes,
  })
}

function mapFrameAnalysisProgress(currentFrame: number, totalFrames: number): number {
  // 把模型加载、逐帧分析和后处理拆到不同的进度区间里，避免冷启动时
  // 进度条从 0% 直接跳进帧分析阶段，用户感知会更稳定。
  const normalized = totalFrames > 0 ? currentFrame / totalFrames : 0
  return Math.round(
    MODEL_LOADING_PROGRESS_END +
      normalized * (FRAME_ANALYSIS_PROGRESS_END - MODEL_LOADING_PROGRESS_END),
  )
}

export async function detectSceneTransNetV2(
  itemData: UnifiedTimelineItemData,
  config: TransNetV2DetectorConfig = {},
): Promise<bigint[]> {
  const bunnyClip = itemData.runtime.bunnyClip
  if (!bunnyClip) {
    throw new Error('BunnyClip不存在')
  }

  if (typeof VideoFrame === 'undefined') {
    throw new Error('当前浏览器不支持 VideoFrame')
  }

  const timeRange = itemData.timeRange
  const startFrame = BigInt(timeRange.timelineStartTime)
  const endFrame = BigInt(timeRange.timelineEndTime)
  const totalFrames = Number(endFrame - startFrame)

  if (totalFrames <= 1) {
    return []
  }

  const threshold = config.threshold ?? TRANSNETV2_DEFAULT_THRESHOLD
  const minShotFrames = config.minShotFrames ?? TRANSNETV2_DEFAULT_MIN_SHOT_FRAMES
  const clonedBunnyClip = bunnyClip.clone()
  const preprocessor = new TransNetV2Preprocessor()
  const probabilities: number[] = []
  const pendingFrames: Float32Array[] = []
  const emptyFramePixels = new Float32Array(
    TRANSNETV2_INPUT_WIDTH * TRANSNETV2_INPUT_HEIGHT * TRANSNETV2_INPUT_CHANNELS,
  )
  let runner: Awaited<ReturnType<typeof loadTransNetV2Runner>> | null = null

  // TransNetV2 只能吃固定长度的窗口，这里先累计预处理后的帧，
  // 凑满一个窗口后再统一做一次推理。
  let lastFramePixels: Float32Array | null = null

  const runPendingWindow = async (validFrameCount: number): Promise<void> => {
    throwIfAborted(config.signal)

    if (!runner) {
      throw new Error('TransNetV2 模型尚未初始化')
    }
    const inputWindow = createTransNetV2Window(pendingFrames)
    const output = await runner.run(inputWindow.data)

    // 最后一个窗口可能会被补齐到模型要求的固定长度，
    // 这里只保留真实时间轴帧对应的输出分数。
    probabilities.push(...Array.from(output.slice(0, validFrameCount)))
    pendingFrames.length = 0
  }

  try {
    throwIfAborted(config.signal)
    reportProgress(config.onProgress, {
      current: 0,
      total: 100,
      stage: 'loading-model',
    })
    runner = await loadTransNetV2Runner({
      signal: config.signal,
      onProgress: (progress) => reportModelLoadProgress(config.onProgress, progress),
    })

    for (let frameOffset = 0; frameOffset < totalFrames; frameOffset++) {
      throwIfAborted(config.signal)

      const currentFrameN = startFrame + BigInt(frameOffset)
      const result = await clonedBunnyClip.tickN(currentFrameN, false, true)
      const videoSample = result.video

      if (!videoSample) {
        // 优先复用上一帧，避免短暂解码缺口被误判成硬切镜头；
        // 只有在第一帧之前还没有任何有效图像时才退回全零帧。
        pendingFrames.push(lastFramePixels ?? emptyFramePixels)
      } else {
        let frame: VideoFrame | null = null

        try {
          frame = await videoSample.toVideoFrame()
          lastFramePixels = preprocessor.preprocessFrame(frame)
          pendingFrames.push(lastFramePixels)
        } finally {
          videoSample.close()
          frame?.close()
        }
      }

      if (pendingFrames.length === TRANSNETV2_WINDOW_SIZE) {
        reportProgress(config.onProgress, {
          current: mapFrameAnalysisProgress(frameOffset + 1, totalFrames),
          total: 100,
          stage: 'detecting-boundaries',
        })
        await runPendingWindow(TRANSNETV2_WINDOW_SIZE)
      }

      if (frameOffset % 30 === 0) {
        reportProgress(config.onProgress, {
          current: mapFrameAnalysisProgress(frameOffset, totalFrames),
          total: 100,
          stage: 'analyzing-frames',
          frameCurrent: frameOffset,
          frameTotal: totalFrames,
        })
      }
    }

    if (pendingFrames.length > 0) {
      reportProgress(config.onProgress, {
        current: FRAME_ANALYSIS_PROGRESS_END,
        total: 100,
        stage: 'detecting-boundaries',
      })
      // 扫描结束后把尾部不足一窗的数据也送进模型。
      // createTransNetV2Window 会负责补齐，而 validFrameCount 用来裁掉补齐部分的输出。
      await runPendingWindow(pendingFrames.length)
    }

    throwIfAborted(config.signal)
    reportProgress(config.onProgress, {
      current: POSTPROCESS_PROGRESS,
      total: 100,
      stage: 'finalizing-boundaries',
    })

    return probabilitiesToTimelineCutFrames(probabilities, {
      threshold,
      minShotFrames,
      startFrame,
      totalFrames: probabilities.length,
    })
  } finally {
    await clonedBunnyClip.dispose()
  }
}
