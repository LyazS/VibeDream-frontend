import * as ort from 'onnxruntime-web/webgpu'
import { loadOnnxModel, type OnnxModelConfig, type OnnxModelLoadOptions } from '@/core/onnx'
import { modelManifest } from '@/generated/model-manifest'
import {
  TRANSNETV2_INPUT_CHANNELS,
  TRANSNETV2_INPUT_HEIGHT,
  TRANSNETV2_INPUT_WIDTH,
  TRANSNETV2_MODEL_ID,
  TRANSNETV2_WINDOW_SIZE,
} from './types'

const transNetV2ModelConfig: OnnxModelConfig = {
  modelId: TRANSNETV2_MODEL_ID,
  version: modelManifest.transnetv2.version,
  chunks: modelManifest.transnetv2.chunks,
  executionProviders: ['webgpu', 'wasm'],
  graphOptimizationLevel: 'all',
  allowExtraOutputs: true,
  cache: {
    enabled: true,
  },
  inputs: [
    {
      tensorType: 'float32',
      shape: [
        1,
        TRANSNETV2_WINDOW_SIZE,
        TRANSNETV2_INPUT_HEIGHT,
        TRANSNETV2_INPUT_WIDTH,
        TRANSNETV2_INPUT_CHANNELS,
      ],
    },
  ],
  outputs: [
    {
      tensorType: 'float32',
      shape: [1, TRANSNETV2_WINDOW_SIZE, 1],
    },
  ],
}

export async function loadTransNetV2Runner(options?: OnnxModelLoadOptions) {
  const runner = await loadOnnxModel(transNetV2ModelConfig, options)
  const inputName = runner.inputNames[0]
  const outputName = runner.outputNames[0]

  if (!inputName || !outputName) {
    throw new Error('TransNetV2 模型输入或输出元数据缺失')
  }

  return {
    inputName,
    outputName,
    async run(input: Float32Array): Promise<Float32Array> {
      const tensor = new ort.Tensor('float32', input, [
        1,
        TRANSNETV2_WINDOW_SIZE,
        TRANSNETV2_INPUT_HEIGHT,
        TRANSNETV2_INPUT_WIDTH,
        TRANSNETV2_INPUT_CHANNELS,
      ])
      const result = await runner.run({ [inputName]: tensor })
      const output = result[outputName]

      if (!output || !(output.data instanceof Float32Array)) {
        throw new Error('TransNetV2 模型输出为空或类型不正确')
      }

      return output.data
    },
  }
}

let backendPreflightPromise: Promise<void> | undefined

/** Load and execute one tiny inference to validate the browser ONNX backend. */
export function verifyTransNetV2Backend(): Promise<void> {
  if (!backendPreflightPromise) {
    backendPreflightPromise = (async () => {
      const runner = await loadTransNetV2Runner()
      await runner.run(
        new Float32Array(
          TRANSNETV2_WINDOW_SIZE *
            TRANSNETV2_INPUT_HEIGHT *
            TRANSNETV2_INPUT_WIDTH *
            TRANSNETV2_INPUT_CHANNELS,
        ),
      )
    })().catch((error) => {
      backendPreflightPromise = undefined
      throw new Error(
        `ONNX_BACKEND_PREFLIGHT_FAILED:${error instanceof Error ? error.message : String(error)}`,
      )
    })
  }

  return backendPreflightPromise
}
