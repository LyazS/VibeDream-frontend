export const TRANSNETV2_MODEL_PATH = 'models/transnetv2/transnetv2.onnx'
export const TRANSNETV2_WINDOW_SIZE = 100
export const TRANSNETV2_INPUT_WIDTH = 48
export const TRANSNETV2_INPUT_HEIGHT = 27
export const TRANSNETV2_INPUT_CHANNELS = 3
export const TRANSNETV2_DEFAULT_THRESHOLD = 0.5
export const TRANSNETV2_DEFAULT_MIN_SHOT_FRAMES = 15

export interface TransNetV2Progress {
  current: number
  total: number
  message: string
}

export interface TransNetV2DetectorConfig {
  threshold?: number
  minShotFrames?: number
  signal?: AbortSignal
  onProgress?: (current: number, total: number, message: string) => void
}

export interface TransNetV2Window {
  data: Float32Array
  validFrameCount: number
}

export interface TransNetV2Session {
  inputName: string
  outputName: string
  run(input: Float32Array): Promise<Float32Array>
}
