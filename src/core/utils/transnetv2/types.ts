export const TRANSNETV2_MODEL_ID = 'transnetv2'
export const TRANSNETV2_MODEL_PATH = 'models/transnetv2/transnetv2.onnx'
export const TRANSNETV2_WINDOW_SIZE = 100
export const TRANSNETV2_INPUT_WIDTH = 48
export const TRANSNETV2_INPUT_HEIGHT = 27
export const TRANSNETV2_INPUT_CHANNELS = 3
export const TRANSNETV2_DEFAULT_THRESHOLD = 0.5
export const TRANSNETV2_DEFAULT_MIN_SHOT_FRAMES = 15

export type TransNetV2ProgressStage =
  | 'loading-model'
  | 'checking-cache'
  | 'loading-from-cache'
  | 'downloading-model'
  | 'initializing-model'
  | 'model-ready'
  | 'detecting-boundaries'
  | 'analyzing-frames'
  | 'finalizing-boundaries'

export interface TransNetV2ProgressEvent {
  current: number
  total: number
  stage: TransNetV2ProgressStage
  progress?: number
  loadedBytes?: number
  totalBytes?: number
  frameCurrent?: number
  frameTotal?: number
}

export interface TransNetV2DetectorConfig {
  threshold?: number
  minShotFrames?: number
  signal?: AbortSignal
  onProgress?: (event: TransNetV2ProgressEvent) => void
}

export interface TransNetV2Window {
  data: Float32Array
  validFrameCount: number
}
