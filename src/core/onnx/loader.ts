import * as ort from 'onnxruntime-web/wasm'
import ortWasmUrl from 'onnxruntime-web/ort-wasm-simd-threaded.wasm?url'
import { loadCachedOnnxModelBytes } from './modelCache'
import type {
  OnnxDimensionExpectation,
  OnnxModelConfig,
  OnnxModelLoadOptions,
  OnnxModelRunner,
  OnnxTensorMetadataExpectation,
} from './types'

const modelCache = new Map<string, Promise<OnnxModelRunner>>()

let wasmConfigured = false

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw new DOMException('模型加载已取消', 'AbortError')
  }
}

async function waitForRunner(
  runnerPromise: Promise<OnnxModelRunner>,
  options?: OnnxModelLoadOptions,
): Promise<OnnxModelRunner> {
  throwIfAborted(options?.signal)

  if (!options?.signal) {
    const runner = await runnerPromise
    options?.onProgress?.({
      stage: 'ready',
      progress: 1,
    })
    return runner
  }

  const abortPromise = new Promise<never>((_, reject) => {
    options.signal?.addEventListener(
      'abort',
      () => reject(new DOMException('模型加载已取消', 'AbortError')),
      { once: true },
    )
  })

  const runner = await Promise.race([runnerPromise, abortPromise])
  options.onProgress?.({
    stage: 'ready',
    progress: 1,
  })
  return runner
}

function configureWasmRuntime(): void {
  if (wasmConfigured) {
    return
  }

  ort.env.wasm.numThreads = 1
  ort.env.wasm.wasmPaths = {
    wasm: ortWasmUrl,
  }
  wasmConfigured = true
}

function assertTensorMetadata(
  modelId: string,
  metadata: ort.InferenceSession.ValueMetadata,
): asserts metadata is ort.InferenceSession.TensorValueMetadata {
  if (!metadata.isTensor) {
    throw new Error(`${modelId} metadata ${metadata.name} 不是 Tensor`)
  }
}

function assertDimension(
  modelId: string,
  metadata: ort.InferenceSession.TensorValueMetadata,
  expectedDimension: OnnxDimensionExpectation,
  actualDimension: string | number,
  index: number,
): void {
  if (expectedDimension === 'any') {
    return
  }

  if (typeof actualDimension !== 'number' || actualDimension !== expectedDimension) {
    throw new Error(
      `${modelId} metadata ${metadata.name} 第 ${index} 维不符合预期: ${metadata.shape.join('x')}`,
    )
  }
}

function validateTensorMetadata(
  modelId: string,
  metadata: ort.InferenceSession.ValueMetadata,
  expected: OnnxTensorMetadataExpectation,
): void {
  assertTensorMetadata(modelId, metadata)

  if (metadata.type !== expected.tensorType) {
    throw new Error(`${modelId} metadata ${metadata.name} 类型不符合预期: ${metadata.type}`)
  }

  if (metadata.shape.length !== expected.shape.length) {
    throw new Error(`${modelId} metadata ${metadata.name} 维度不符合预期: ${metadata.shape.join('x')}`)
  }

  expected.shape.forEach((expectedDimension, index) => {
    assertDimension(modelId, metadata, expectedDimension, metadata.shape[index], index)
  })
}

function validateMetadataList(
  modelId: string,
  kind: '输入' | '输出',
  actualMetadata: readonly ort.InferenceSession.ValueMetadata[],
  actualNames: readonly string[],
  expectedList: readonly OnnxTensorMetadataExpectation[],
  allowExtraMetadata = false,
): void {
  if (actualNames.length < expectedList.length) {
    throw new Error(`${modelId} ${kind}数量不符合预期: ${actualNames.length}`)
  }

  if (!allowExtraMetadata && actualNames.length !== expectedList.length) {
    throw new Error(`${modelId} ${kind}数量不符合预期: ${actualNames.length}`)
  }

  expectedList.forEach((expected, index) => {
    const actualName = actualNames[index]
    const metadata = actualMetadata.find((item) => item.name === actualName)

    if (!actualName || !metadata) {
      throw new Error(`${modelId} ${kind} metadata 缺失`)
    }

    if (expected.name && expected.name !== actualName) {
      throw new Error(`${modelId} ${kind}名称不符合预期: ${actualName}`)
    }

    validateTensorMetadata(modelId, metadata, expected)
  })
}

async function createOnnxModelRunner(
  config: OnnxModelConfig,
  options?: OnnxModelLoadOptions,
): Promise<OnnxModelRunner> {
  configureWasmRuntime()

  const modelBytes = await loadCachedOnnxModelBytes(config, options)
  throwIfAborted(options?.signal)
  options?.onProgress?.({
    stage: 'initializing-session',
  })

  const session = await ort.InferenceSession.create(modelBytes, {
    executionProviders: [...config.executionProviders],
    graphOptimizationLevel: config.graphOptimizationLevel ?? 'all',
  })

  validateMetadataList(
    config.modelId,
    '输入',
    session.inputMetadata,
    session.inputNames,
    config.inputs,
    config.allowExtraInputs,
  )
  validateMetadataList(
    config.modelId,
    '输出',
    session.outputMetadata,
    session.outputNames,
    config.outputs,
    config.allowExtraOutputs,
  )

  return {
    modelId: config.modelId,
    executionProvider: config.executionProviders[0] ?? 'wasm',
    inputNames: session.inputNames,
    outputNames: session.outputNames,
    run(feeds, options) {
      return session.run(feeds, options)
    },
    release() {
      return session.release()
    },
  }
}

export function loadOnnxModel(
  config: OnnxModelConfig,
  options?: OnnxModelLoadOptions,
): Promise<OnnxModelRunner> {
  const cached = modelCache.get(config.modelId)
  if (cached) {
    return waitForRunner(cached, options)
  }

  const runnerPromise = createOnnxModelRunner(config, options).catch((error) => {
    modelCache.delete(config.modelId)
    throw error
  })

  modelCache.set(config.modelId, runnerPromise)
  return waitForRunner(runnerPromise, options)
}

export async function disposeOnnxModel(modelId: string): Promise<void> {
  const runnerPromise = modelCache.get(modelId)
  if (!runnerPromise) {
    return
  }

  modelCache.delete(modelId)
  const runner = await runnerPromise
  await runner.release()
}

export async function clearOnnxModelCache(): Promise<void> {
  const modelIds = [...modelCache.keys()]
  await Promise.all(modelIds.map((modelId) => disposeOnnxModel(modelId)))
}
