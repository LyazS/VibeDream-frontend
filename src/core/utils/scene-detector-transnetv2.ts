import type { UnifiedTimelineItemData } from '@/core/timelineitem/type'
import { loadTransNetV2Session } from './transnetv2/modelLoader'
import { probabilitiesToTimelineCutFrames } from './transnetv2/cutPostprocess'
import { createTransNetV2Window, TransNetV2Preprocessor } from './transnetv2/preprocessing'
import {
  TRANSNETV2_DEFAULT_MIN_SHOT_FRAMES,
  TRANSNETV2_DEFAULT_THRESHOLD,
  TRANSNETV2_INPUT_CHANNELS,
  TRANSNETV2_INPUT_HEIGHT,
  TRANSNETV2_INPUT_WIDTH,
  TRANSNETV2_WINDOW_SIZE,
  type TransNetV2DetectorConfig,
} from './transnetv2/types'

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw new DOMException('场景检测已取消', 'AbortError')
  }
}

function reportProgress(
  onProgress: TransNetV2DetectorConfig['onProgress'],
  current: number,
  total: number,
  message: string,
): void {
  onProgress?.(current, total, message)
}

/**
 * 使用 TransNetV2 ONNX 模型检测时间线视频片段中的镜头边界。
 *
 * 返回值为时间线帧号，保持与旧 scene detector 一致，调用方可直接传给分割命令。
 */
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

  let lastFramePixels: Float32Array | null = null

  const runPendingWindow = async (validFrameCount: number): Promise<void> => {
    throwIfAborted(config.signal)

    const session = await loadTransNetV2Session()
    const inputWindow = createTransNetV2Window(pendingFrames)
    const output = await session.run(inputWindow.data)

    probabilities.push(...Array.from(output.slice(0, validFrameCount)))
    pendingFrames.length = 0
  }

  try {
    throwIfAborted(config.signal)
    reportProgress(config.onProgress, 0, totalFrames, '加载智能分镜模型...')
    await loadTransNetV2Session()

    for (let frameOffset = 0; frameOffset < totalFrames; frameOffset++) {
      throwIfAborted(config.signal)

      const currentFrameN = startFrame + BigInt(frameOffset)
      const result = await clonedBunnyClip.tickN(currentFrameN, false, true)
      const videoSample = result.video

      if (!videoSample) {
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
        reportProgress(config.onProgress, frameOffset + 1, totalFrames, 'AI 识别镜头边界...')
        await runPendingWindow(TRANSNETV2_WINDOW_SIZE)
      }

      if (frameOffset % 30 === 0) {
        reportProgress(
          config.onProgress,
          frameOffset,
          totalFrames,
          `分析视频帧 ${frameOffset}/${totalFrames}`,
        )
      }
    }

    if (pendingFrames.length > 0) {
      reportProgress(config.onProgress, totalFrames, totalFrames, 'AI 识别镜头边界...')
      await runPendingWindow(pendingFrames.length)
    }

    throwIfAborted(config.signal)
    reportProgress(config.onProgress, totalFrames, totalFrames, '整理镜头边界...')

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
