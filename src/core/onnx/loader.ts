import * as ort from 'onnxruntime-web/webgpu'
import { ENABLE_ORT_CDN_FALLBACK, resolveAssetUrl } from '@/config/runtimeConfig'
import { wasmManifest } from '@/generated/model-manifest'
import { loadCachedOnnxModelBytes } from './modelCache'
import type {
  OnnxDimensionExpectation,
  OnnxExecutionProvider,
  OnnxModelConfig,
  OnnxModelLoadOptions,
  OnnxModelRunner,
  OnnxTensorMetadataExpectation,
} from './types'

const modelCache = new Map<string, Promise<OnnxModelRunner>>()

const ORT_WASM_FILE_NAME = 'ort-wasm-simd-threaded.asyncify.wasm'
const ORT_WASM_MODULE_FILE_NAME = 'ort-wasm-simd-threaded.asyncify.mjs'
const WASM_FETCH_TIMEOUT_MS = 30_000
const ortWasmCdnAssetBases = [
  `https://cdn.jsdelivr.net/npm/onnxruntime-web@${ort.env.versions.web}/dist`,
  `https://unpkg.com/onnxruntime-web@${ort.env.versions.web}/dist`,
]

interface OrtWasmAssetCandidate {
  source: string
  wasmUrl: string
  mjsUrl: string
}

let wasmConfigurationPromise: Promise<void> | undefined

interface WebGpuNavigator {
  gpu?: {
    requestAdapter(): Promise<unknown | null>
  }
}

function formatDuration(durationMs: number): string {
  return `${durationMs.toFixed(1)} ms`
}

function logOnnxDebug(modelId: string, message: string): void {
  if (import.meta.env.DEV) {
    console.info(`[ONNX][${modelId}] ${message}`)
  }
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

async function isWebGpuAvailable(): Promise<boolean> {
  const gpu = (globalThis.navigator as WebGpuNavigator | undefined)?.gpu
  if (!gpu) {
    return false
  }

  try {
    return (await gpu.requestAdapter()) !== null
  } catch {
    return false
  }
}

async function resolveExecutionProviders(
  config: OnnxModelConfig,
): Promise<OnnxExecutionProvider[]> {
  if (!config.executionProviders.includes('webgpu') || (await isWebGpuAvailable())) {
    return [...config.executionProviders]
  }

  const fallbackProviders = config.executionProviders.filter((provider) => provider !== 'webgpu')
  if (fallbackProviders.length > 0) {
    logOnnxDebug(config.modelId, 'WebGPU 不可用，回退到 WASM/CPU')
    return fallbackProviders
  }

  return [...config.executionProviders]
}

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

async function fetchWasmBinary(url: string): Promise<ArrayBuffer> {
  const controller = new AbortController()
  const timeoutId = globalThis.setTimeout(() => controller.abort(), WASM_FETCH_TIMEOUT_MS)

  try {
    const response = await fetch(url, { signal: controller.signal })
    if (!response.ok) {
      throw new Error(`WASM 下载失败: ${response.status}`)
    }

    return response.arrayBuffer()
  } finally {
    globalThis.clearTimeout(timeoutId)
  }
}

async function checkWasmModule(url: string): Promise<void> {
  const controller = new AbortController()
  const timeoutId = globalThis.setTimeout(() => controller.abort(), WASM_FETCH_TIMEOUT_MS)

  try {
    const response = await fetch(url, {
      method: 'HEAD',
      cache: 'no-store',
      signal: controller.signal,
    })
    if (!response.ok) {
      throw new Error(`WASM 模块下载失败: ${response.status}`)
    }
  } finally {
    globalThis.clearTimeout(timeoutId)
  }
}

async function fetchFirstAvailableWasmAsset(
  candidates: readonly OrtWasmAssetCandidate[],
): Promise<{ wasmBinary: ArrayBuffer; mjsUrl: string }> {
  let lastError: unknown

  for (const candidate of candidates) {
    try {
      // Both files must come from the same source. ONNX Runtime imports the
      // module separately, so a successful binary download alone is not enough.
      await checkWasmModule(candidate.mjsUrl)
      return {
        wasmBinary: await fetchWasmBinary(candidate.wasmUrl),
        mjsUrl: candidate.mjsUrl,
      }
    } catch (error) {
      lastError = new Error(`${candidate.source}: ${getErrorMessage(error)}`)
    }
  }

  throw lastError ?? new Error('所有 ONNX WASM 资源均不可用')
}

async function configureWasmRuntime(): Promise<void> {
  if (wasmConfigurationPromise) {
    return wasmConfigurationPromise
  }

  wasmConfigurationPromise = (async () => {
    ort.env.wasm.numThreads = 1

    const configuredAssetUrl = resolveAssetUrl(wasmManifest.ort.path)
    const configuredModuleUrl = resolveAssetUrl(wasmManifest.ortMjs.path)
    const candidates: OrtWasmAssetCandidate[] = [
      {
        source: 'R2',
        wasmUrl: configuredAssetUrl,
        mjsUrl: configuredModuleUrl,
      },
      ...(ENABLE_ORT_CDN_FALLBACK
        ? ortWasmCdnAssetBases.map((baseUrl, index) => ({
            source: `CDN ${index + 1}`,
            wasmUrl: `${baseUrl}/${ORT_WASM_FILE_NAME}`,
            mjsUrl: `${baseUrl}/${ORT_WASM_MODULE_FILE_NAME}`,
          }))
        : []),
    ]

    // Download and select a complete resource pair before ONNX Runtime starts.
    const { wasmBinary, mjsUrl } = await fetchFirstAvailableWasmAsset(candidates)
    ort.env.wasm.wasmPaths = { mjs: mjsUrl }
    ort.env.wasm.wasmBinary = wasmBinary
  })().catch((error) => {
    wasmConfigurationPromise = undefined
    throw error
  })

  return wasmConfigurationPromise
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
    throw new Error(
      `${modelId} metadata ${metadata.name} 维度不符合预期: ${metadata.shape.join('x')}`,
    )
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
  const modelLoadStartedAt = performance.now()
  await configureWasmRuntime()

  const modelBytes = await loadCachedOnnxModelBytes(config, options)
  throwIfAborted(options?.signal)
  options?.onProgress?.({
    stage: 'initializing-session',
  })

  const sessionOptions = {
    graphOptimizationLevel: config.graphOptimizationLevel ?? 'all',
  }
  const executionProviders = await resolveExecutionProviders(config)
  let executionProvider = executionProviders[0] ?? 'wasm'
  const sessionInitializationStartedAt = performance.now()
  let session: ort.InferenceSession

  try {
    session = await ort.InferenceSession.create(modelBytes, {
      ...sessionOptions,
      executionProviders,
    })
  } catch (error) {
    if (executionProvider !== 'webgpu' || !config.executionProviders.includes('wasm')) {
      throw error
    }

    logOnnxDebug(
      config.modelId,
      `WebGPU 会话初始化失败 (${getErrorMessage(error)})，回退到 WASM/CPU`,
    )
    session = await ort.InferenceSession.create(modelBytes, {
      ...sessionOptions,
      executionProviders: ['wasm'],
    })
    executionProvider = 'wasm'
  }

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

  logOnnxDebug(
    config.modelId,
    `执行提供程序: ${executionProvider === 'webgpu' ? 'WebGPU' : 'WASM/CPU'}，` +
      `会话初始化 ${formatDuration(performance.now() - sessionInitializationStartedAt)}，` +
      `模型加载总计 ${formatDuration(performance.now() - modelLoadStartedAt)}`,
  )

  let inferenceCount = 0
  let totalInferenceDuration = 0

  return {
    modelId: config.modelId,
    executionProvider,
    inputNames: session.inputNames,
    outputNames: session.outputNames,
    async run(feeds, options) {
      const currentInference = ++inferenceCount
      const inferenceStartedAt = performance.now()
      let inferenceFailed = false

      try {
        return await session.run(feeds, options)
      } catch (error) {
        inferenceFailed = true
        throw error
      } finally {
        const inferenceDuration = performance.now() - inferenceStartedAt
        totalInferenceDuration += inferenceDuration
        logOnnxDebug(
          config.modelId,
          `${executionProvider === 'webgpu' ? 'WebGPU' : 'WASM/CPU'} 推理 #${currentInference}` +
            `${inferenceFailed ? '失败，' : ': '}` +
            `${formatDuration(inferenceDuration)}，累计 ${formatDuration(totalInferenceDuration)}`,
        )
      }
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
