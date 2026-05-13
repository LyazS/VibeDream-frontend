import * as ort from 'onnxruntime-web/wasm'
import ortWasmUrl from 'onnxruntime-web/ort-wasm-simd-threaded.wasm?url'
import {
  TRANSNETV2_INPUT_CHANNELS,
  TRANSNETV2_INPUT_HEIGHT,
  TRANSNETV2_INPUT_WIDTH,
  TRANSNETV2_MODEL_PATH,
  TRANSNETV2_WINDOW_SIZE,
  type TransNetV2Session,
} from './types'

let sessionPromise: Promise<TransNetV2Session> | null = null

function getPublicUrl(path: string): string {
  const base = import.meta.env.BASE_URL || '/'
  return `${base}${path}`.replace(/\/{2,}/g, '/')
}

function assertTensorMetadata(
  metadata: ort.InferenceSession.ValueMetadata,
): asserts metadata is ort.InferenceSession.TensorValueMetadata {
  if (!metadata.isTensor) {
    throw new Error(`TransNetV2 ${metadata.name} 不是 Tensor`)
  }
}

function assertExpectedInputShape(metadata: ort.InferenceSession.ValueMetadata): void {
  assertTensorMetadata(metadata)

  const expected = [
    1,
    TRANSNETV2_WINDOW_SIZE,
    TRANSNETV2_INPUT_HEIGHT,
    TRANSNETV2_INPUT_WIDTH,
    TRANSNETV2_INPUT_CHANNELS,
  ]

  if (metadata.type !== 'float32') {
    throw new Error(`TransNetV2 输入类型不符合预期: ${metadata.type}`)
  }

  if (metadata.shape.length !== expected.length) {
    throw new Error(`TransNetV2 输入维度不符合预期: ${metadata.shape.join('x')}`)
  }

  for (let index = 0; index < expected.length; index++) {
    const actual = metadata.shape[index]
    if (typeof actual === 'number' && actual !== expected[index]) {
      throw new Error(`TransNetV2 输入 shape 不符合预期: ${metadata.shape.join('x')}`)
    }
  }
}

function assertExpectedOutputShape(metadata: ort.InferenceSession.ValueMetadata): void {
  assertTensorMetadata(metadata)

  if (metadata.type !== 'float32') {
    throw new Error(`TransNetV2 输出类型不符合预期: ${metadata.type}`)
  }

  if (metadata.shape.length !== 3) {
    throw new Error(`TransNetV2 输出维度不符合预期: ${metadata.shape.join('x')}`)
  }

  const [, frameDimension, channelDimension] = metadata.shape
  if (typeof frameDimension === 'number' && frameDimension !== TRANSNETV2_WINDOW_SIZE) {
    throw new Error(`TransNetV2 输出帧数不符合预期: ${metadata.shape.join('x')}`)
  }
  if (typeof channelDimension === 'number' && channelDimension !== 1) {
    throw new Error(`TransNetV2 输出通道数不符合预期: ${metadata.shape.join('x')}`)
  }
}

async function createTransNetV2Session(): Promise<TransNetV2Session> {
  ort.env.wasm.numThreads = 1
  ort.env.wasm.wasmPaths = {
    wasm: ortWasmUrl,
  }

  const session = await ort.InferenceSession.create(getPublicUrl(TRANSNETV2_MODEL_PATH), {
    executionProviders: ['wasm'],
    graphOptimizationLevel: 'all',
  })

  const inputName = session.inputNames[0]
  const outputName = session.outputNames[0]
  const inputMetadata = session.inputMetadata.find((metadata) => metadata.name === inputName)
  const outputMetadata = session.outputMetadata.find((metadata) => metadata.name === outputName)

  if (!inputName || !outputName || !inputMetadata || !outputMetadata) {
    throw new Error('TransNetV2 模型输入或输出元数据缺失')
  }

  assertExpectedInputShape(inputMetadata)
  assertExpectedOutputShape(outputMetadata)

  return {
    inputName,
    outputName,
    async run(input: Float32Array) {
      const tensor = new ort.Tensor('float32', input, [
        1,
        TRANSNETV2_WINDOW_SIZE,
        TRANSNETV2_INPUT_HEIGHT,
        TRANSNETV2_INPUT_WIDTH,
        TRANSNETV2_INPUT_CHANNELS,
      ])
      const result = await session.run({ [inputName]: tensor })
      const output = result[outputName]

      if (!output || !(output.data instanceof Float32Array)) {
        throw new Error('TransNetV2 模型输出为空或类型不正确')
      }

      return output.data
    },
  }
}

export function loadTransNetV2Session(): Promise<TransNetV2Session> {
  sessionPromise ??= createTransNetV2Session().catch((error) => {
    sessionPromise = null
    throw error
  })

  return sessionPromise
}
