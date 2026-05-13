import {
  TRANSNETV2_INPUT_CHANNELS,
  TRANSNETV2_INPUT_HEIGHT,
  TRANSNETV2_INPUT_WIDTH,
  TRANSNETV2_WINDOW_SIZE,
  type TransNetV2Window,
} from './types'

type CanvasLike = OffscreenCanvas | HTMLCanvasElement
type CanvasContextLike = OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D

const FRAME_FLOAT_COUNT =
  TRANSNETV2_INPUT_WIDTH * TRANSNETV2_INPUT_HEIGHT * TRANSNETV2_INPUT_CHANNELS

function createResizeCanvas(): { canvas: CanvasLike; ctx: CanvasContextLike } {
  let canvas: CanvasLike
  let ctx: CanvasContextLike | null

  if (typeof OffscreenCanvas !== 'undefined') {
    canvas = new OffscreenCanvas(TRANSNETV2_INPUT_WIDTH, TRANSNETV2_INPUT_HEIGHT)
    ctx = canvas.getContext('2d', { willReadFrequently: true })
  } else {
    canvas = document.createElement('canvas')
    canvas.width = TRANSNETV2_INPUT_WIDTH
    canvas.height = TRANSNETV2_INPUT_HEIGHT
    ctx = canvas.getContext('2d', { willReadFrequently: true })
  }

  if (!ctx) {
    throw new Error('无法创建 TransNetV2 预处理 Canvas')
  }

  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = 'high'

  return { canvas, ctx }
}

export class TransNetV2Preprocessor {
  private readonly ctx: CanvasContextLike

  constructor() {
    const { ctx } = createResizeCanvas()
    this.ctx = ctx
  }

  preprocessFrame(frame: VideoFrame): Float32Array {
    this.ctx.clearRect(0, 0, TRANSNETV2_INPUT_WIDTH, TRANSNETV2_INPUT_HEIGHT)
    this.ctx.drawImage(frame, 0, 0, TRANSNETV2_INPUT_WIDTH, TRANSNETV2_INPUT_HEIGHT)

    const rgba = this.ctx.getImageData(0, 0, TRANSNETV2_INPUT_WIDTH, TRANSNETV2_INPUT_HEIGHT).data
    const rgb = new Float32Array(FRAME_FLOAT_COUNT)

    for (let source = 0, target = 0; source < rgba.length; source += 4) {
      rgb[target++] = rgba[source]
      rgb[target++] = rgba[source + 1]
      rgb[target++] = rgba[source + 2]
    }

    return rgb
  }
}

export function createTransNetV2Window(frames: Float32Array[]): TransNetV2Window {
  if (frames.length === 0) {
    throw new Error('TransNetV2 推理窗口不能为空')
  }

  const data = new Float32Array(TRANSNETV2_WINDOW_SIZE * FRAME_FLOAT_COUNT)
  const lastFrame = frames[frames.length - 1]

  for (let frameIndex = 0; frameIndex < TRANSNETV2_WINDOW_SIZE; frameIndex++) {
    const frame = frames[frameIndex] ?? lastFrame
    data.set(frame, frameIndex * FRAME_FLOAT_COUNT)
  }

  return {
    data,
    validFrameCount: frames.length,
  }
}
