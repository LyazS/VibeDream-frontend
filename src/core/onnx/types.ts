import type * as ort from 'onnxruntime-web/wasm'

export type OnnxExecutionProvider = 'wasm'
export type OnnxDimensionExpectation = number | 'any'

export interface OnnxModelCacheOptions {
  enabled?: boolean
}

export interface OnnxModelChunk {
  path: string
  size: number
}

export type OnnxModelLoadStage =
  | 'checking-cache'
  | 'loading-from-cache'
  | 'downloading-model'
  | 'initializing-session'
  | 'ready'

export interface OnnxModelLoadProgress {
  stage: OnnxModelLoadStage
  loadedBytes?: number
  totalBytes?: number
  progress?: number
}

export interface OnnxModelLoadOptions {
  signal?: AbortSignal
  onProgress?: (progress: OnnxModelLoadProgress) => void
}

export interface OnnxTensorMetadataExpectation {
  name?: string
  tensorType: ort.Tensor.Type
  shape: readonly OnnxDimensionExpectation[]
}

export interface OnnxModelConfig {
  modelId: string
  version: string
  modelPath: string
  chunks?: readonly OnnxModelChunk[]
  executionProviders: readonly OnnxExecutionProvider[]
  graphOptimizationLevel?: ort.InferenceSession.SessionOptions['graphOptimizationLevel']
  allowExtraInputs?: boolean
  allowExtraOutputs?: boolean
  cache?: OnnxModelCacheOptions
  inputs: readonly OnnxTensorMetadataExpectation[]
  outputs: readonly OnnxTensorMetadataExpectation[]
}

export interface OnnxModelRunner {
  modelId: string
  executionProvider: OnnxExecutionProvider
  inputNames: readonly string[]
  outputNames: readonly string[]
  run(
    feeds: ort.InferenceSession.FeedsType,
    options?: ort.InferenceSession.RunOptions,
  ): Promise<ort.InferenceSession.ReturnType>
  release(): Promise<void>
}
