import { BunnyMedia } from '@/core/mediabunny/bunny-media'
import { BunnyClip } from '@/core/mediabunny/bunny-clip'
import { loadTransNetV2Runner } from './modelRunner'
import { TransNetV2Preprocessor, createTransNetV2Window } from './preprocessing'
import { probabilitiesToTimelineCutFrames } from './cutPostprocess'
import {
  TRANSNETV2_DEFAULT_MIN_SHOT_FRAMES,
  TRANSNETV2_DEFAULT_THRESHOLD,
  TRANSNETV2_INPUT_CHANNELS,
  TRANSNETV2_INPUT_HEIGHT,
  TRANSNETV2_INPUT_WIDTH,
  TRANSNETV2_WINDOW_SIZE,
  type TransNetV2ProgressEvent,
} from './types'
import type { OnnxModelLoadProgress } from '@/core/onnx'

const MODEL_LOADING_PROGRESS_END = 20
const FRAME_ANALYSIS_PROGRESS_END = 95
const POSTPROCESS_PROGRESS = 98

interface DetectMessage {
  type: 'detect'
  file: File
  timeRange: {
    timelineStartTime: number
    timelineEndTime: number
    clipStartTime: number
    clipEndTime: number
  }
  config: {
    threshold?: number
    minShotFrames?: number
  }
}

type InboundMessage =
  | (DetectMessage & { type: 'detect' })
  | { type: 'abort' }

let aborted = false

function throwIfAborted(): void {
  if (aborted) {
    throw new DOMException('场景检测已取消', 'AbortError')
  }
}

function postProgress(event: TransNetV2ProgressEvent): void {
  self.postMessage({ type: 'progress', event })
}

function mapFrameAnalysisProgress(currentFrame: number, totalFrames: number): number {
  const normalized = totalFrames > 0 ? currentFrame / totalFrames : 0
  return Math.round(
    MODEL_LOADING_PROGRESS_END +
      normalized * (FRAME_ANALYSIS_PROGRESS_END - MODEL_LOADING_PROGRESS_END),
  )
}

function reportModelLoadProgress(progress: OnnxModelLoadProgress): void {
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

  postProgress({
    current,
    total: 100,
    stage,
    progress: progress.progress,
    loadedBytes: progress.loadedBytes,
    totalBytes: progress.totalBytes,
  })
}

async function detect(message: DetectMessage): Promise<void> {
  const { file, timeRange, config } = message
  aborted = false

  const startFrame = BigInt(timeRange.timelineStartTime)
  const endFrame = BigInt(timeRange.timelineEndTime)
  const totalFrames = Number(endFrame - startFrame)

  if (totalFrames <= 1) {
    self.postMessage({ type: 'done', boundaries: [] })
    return
  }

  const threshold = config.threshold ?? TRANSNETV2_DEFAULT_THRESHOLD
  const minShotFrames = config.minShotFrames ?? TRANSNETV2_DEFAULT_MIN_SHOT_FRAMES

  const bunnyMedia = new BunnyMedia(file)
  await bunnyMedia.ready

  const bunnyClip = new BunnyClip(bunnyMedia)
  bunnyClip.setTimeRange({
    clipStart: BigInt(timeRange.clipStartTime),
    clipEnd: BigInt(timeRange.clipEndTime),
    timelineStart: startFrame,
    timelineEnd: endFrame,
  })

  const clonedBunnyClip = bunnyClip.clone()
  const preprocessor = new TransNetV2Preprocessor()
  const probabilities: number[] = []
  const pendingFrames: Float32Array[] = []
  const emptyFramePixels = new Float32Array(
    TRANSNETV2_INPUT_WIDTH * TRANSNETV2_INPUT_HEIGHT * TRANSNETV2_INPUT_CHANNELS,
  )
  let lastFramePixels: Float32Array | null = null

  const runPendingWindow = async (validFrameCount: number): Promise<void> => {
    throwIfAborted()

    if (!runner) {
      throw new Error('TransNetV2 模型尚未初始化')
    }
    const inputWindow = createTransNetV2Window(pendingFrames)
    const output = await runner.run(inputWindow.data)

    probabilities.push(...Array.from(output.slice(0, validFrameCount)))
    pendingFrames.length = 0
  }

  let runner: Awaited<ReturnType<typeof loadTransNetV2Runner>> | null = null

  try {
    throwIfAborted()
    postProgress({
      current: 0,
      total: 100,
      stage: 'loading-model',
    })
    runner = await loadTransNetV2Runner({
      onProgress: reportModelLoadProgress,
    })

    for (let frameOffset = 0; frameOffset < totalFrames; frameOffset++) {
      throwIfAborted()

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
        postProgress({
          current: mapFrameAnalysisProgress(frameOffset + 1, totalFrames),
          total: 100,
          stage: 'detecting-boundaries',
        })
        await runPendingWindow(TRANSNETV2_WINDOW_SIZE)
      }

      if (frameOffset % 30 === 0) {
        postProgress({
          current: mapFrameAnalysisProgress(frameOffset, totalFrames),
          total: 100,
          stage: 'analyzing-frames',
          frameCurrent: frameOffset,
          frameTotal: totalFrames,
        })
      }
    }

    if (pendingFrames.length > 0) {
      postProgress({
        current: FRAME_ANALYSIS_PROGRESS_END,
        total: 100,
        stage: 'detecting-boundaries',
      })
      await runPendingWindow(pendingFrames.length)
    }

    throwIfAborted()
    postProgress({
      current: POSTPROCESS_PROGRESS,
      total: 100,
      stage: 'finalizing-boundaries',
    })

    const boundaries = probabilitiesToTimelineCutFrames(probabilities, {
      threshold,
      minShotFrames,
      startFrame,
      totalFrames: probabilities.length,
    })

    self.postMessage({
      type: 'done',
      boundaries: boundaries.map((b) => b.toString()),
    })
  } finally {
    await clonedBunnyClip.dispose()
    await bunnyMedia.dispose()
  }
}

self.onmessage = async (e: MessageEvent<InboundMessage>) => {
  const { type } = e.data

  if (type === 'abort') {
    aborted = true
    return
  }

  if (type === 'detect') {
    try {
      await detect(e.data)
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') {
        self.postMessage({ type: 'error', message: '场景检测已取消' })
        return
      }
      self.postMessage({
        type: 'error',
        message: error instanceof Error ? error.message : String(error),
      })
    }
  }
}
