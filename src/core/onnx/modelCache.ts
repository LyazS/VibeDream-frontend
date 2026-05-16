import type { OnnxModelConfig, OnnxModelLoadOptions, OnnxModelLoadProgress } from './types'

const MODEL_CACHE_NAME = 'lightcut-onnx-models-v1'
const MODEL_CACHE_PREFIX = '/__onnx_model_cache__'
const MODEL_CHUNK_RETRY_COUNT = 3

function getPublicUrl(path: string): string {
  const base = import.meta.env.BASE_URL || '/'
  return `${base}${path}`.replace(/\/{2,}/g, '/')
}

function getCacheKey(config: Pick<OnnxModelConfig, 'modelId' | 'version'>): string {
  return `${MODEL_CACHE_PREFIX}/${config.modelId}/${config.version}`
}

function isModelCacheEnabled(config: OnnxModelConfig): boolean {
  return config.cache?.enabled !== false
}

function canUseCacheStorage(): boolean {
  return typeof window !== 'undefined' && 'caches' in window
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw new DOMException('模型加载已取消', 'AbortError')
  }
}

function reportProgress(
  options: OnnxModelLoadOptions | undefined,
  progress: OnnxModelLoadProgress,
): void {
  options?.onProgress?.(progress)
}

async function fetchChunkResponse(
  chunkPath: string,
  signal?: AbortSignal,
): Promise<Response> {
  throwIfAborted(signal)
  const response = await fetch(getPublicUrl(chunkPath), { signal })
  if (!response.ok) {
    throw new Error(`模型分片下载失败: ${chunkPath} ${response.status}`)
  }
  return response
}

async function pruneOldModelVersions(config: OnnxModelConfig): Promise<void> {
  if (!canUseCacheStorage()) {
    return
  }

  try {
    const cache = await caches.open(MODEL_CACHE_NAME)
    const keys = await cache.keys()

    await Promise.all(
      keys
        .filter((request) => request.url.includes(`${MODEL_CACHE_PREFIX}/${config.modelId}/`))
        .filter((request) => request.url !== new URL(getCacheKey(config), window.location.origin).href)
        .map((request) => cache.delete(request)),
    )
  } catch {
    // Old cache cleanup is best-effort and should not block inference.
  }
}

async function readChunkResponseAsUint8Array(
  response: Response,
  chunkIndex: number,
  chunkProgress: number[],
  totalBytes: number,
  options?: OnnxModelLoadOptions,
): Promise<Uint8Array> {
  const reader = response.body?.getReader()

  if (!reader) {
    const arrayBuffer = await response.arrayBuffer()
    chunkProgress[chunkIndex] = arrayBuffer.byteLength
    reportProgress(options, {
      stage: 'downloading-model',
      loadedBytes: chunkProgress.reduce((sum, value) => sum + value, 0),
      totalBytes,
      progress: totalBytes > 0 ? chunkProgress.reduce((sum, value) => sum + value, 0) / totalBytes : undefined,
    })
    return new Uint8Array(arrayBuffer)
  }

  const chunks: Uint8Array[] = []
  let chunkLoadedBytes = 0

  while (true) {
    throwIfAborted(options?.signal)
    const { done, value } = await reader.read()

    if (done) {
      break
    }

    if (!value) {
      continue
    }

    chunks.push(value)
    chunkLoadedBytes += value.byteLength
    chunkProgress[chunkIndex] = chunkLoadedBytes
    const loadedBytes = chunkProgress.reduce((sum, current) => sum + current, 0)

    reportProgress(options, {
      stage: 'downloading-model',
      loadedBytes,
      totalBytes,
      progress: totalBytes > 0 ? loadedBytes / totalBytes : undefined,
    })
  }

  const merged = new Uint8Array(chunkLoadedBytes)
  let offset = 0
  for (const chunk of chunks) {
    merged.set(chunk, offset)
    offset += chunk.byteLength
  }

  return merged
}

function mergeChunkArrays(chunks: readonly Uint8Array[]): ArrayBuffer {
  const totalLength = chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0)
  const merged = new Uint8Array(totalLength)
  let offset = 0

  for (const chunk of chunks) {
    merged.set(chunk, offset)
    offset += chunk.byteLength
  }

  return merged.buffer
}

async function fetchChunkedModelBytes(
  config: OnnxModelConfig,
  options?: OnnxModelLoadOptions,
): Promise<ArrayBuffer> {
  const chunks = config.chunks
  if (!chunks || chunks.length === 0) {
    throw new Error(`${config.modelId} 缺少模型分片配置`)
  }

  const totalBytes = chunks.reduce((sum, chunk) => sum + chunk.size, 0)
  const chunkProgress = chunks.map(() => 0)

  reportProgress(options, {
    stage: 'downloading-model',
    loadedBytes: 0,
    totalBytes,
    progress: 0,
  })

  const fetchChunkWithRetry = async (chunkPath: string, chunkIndex: number): Promise<Uint8Array> => {
    let lastError: unknown = null

    for (let attempt = 1; attempt <= MODEL_CHUNK_RETRY_COUNT; attempt += 1) {
      throwIfAborted(options?.signal)
      chunkProgress[chunkIndex] = 0

      try {
        const response = await fetchChunkResponse(chunkPath, options?.signal)
        return await readChunkResponseAsUint8Array(
          response,
          chunkIndex,
          chunkProgress,
          totalBytes,
          options,
        )
      } catch (error) {
        if (error instanceof Error && error.name === 'AbortError') {
          throw error
        }

        lastError = error
      }
    }

    throw new Error(
      `${config.modelId} 模型分片下载失败，已重试 ${MODEL_CHUNK_RETRY_COUNT} 次: ${chunkPath}. ${String(lastError)}`,
    )
  }

  const chunkBuffers = await Promise.all(
    chunks.map((chunk, index) => fetchChunkWithRetry(chunk.path, index)),
  )

  return mergeChunkArrays(chunkBuffers)
}

async function loadModelBytesWithoutPersistentCache(
  config: OnnxModelConfig,
  options?: OnnxModelLoadOptions,
): Promise<ArrayBuffer> {
  if (!config.chunks || config.chunks.length === 0) {
    throw new Error(`${config.modelId} 未配置模型分片，前端不会回退到单文件下载`)
  }

  return fetchChunkedModelBytes(config, options)
}

export async function loadCachedOnnxModelBytes(
  config: OnnxModelConfig,
  options?: OnnxModelLoadOptions,
): Promise<ArrayBuffer> {
  if (!isModelCacheEnabled(config) || !canUseCacheStorage()) {
    return loadModelBytesWithoutPersistentCache(config, options)
  }

  throwIfAborted(options?.signal)
  reportProgress(options, {
    stage: 'checking-cache',
  })
  const cache = await caches.open(MODEL_CACHE_NAME)
  const cacheKey = getCacheKey(config)

  try {
    const cachedResponse = await cache.match(cacheKey)
    if (cachedResponse) {
      reportProgress(options, {
        stage: 'loading-from-cache',
        loadedBytes: 0,
      })
      return cachedResponse.arrayBuffer()
    }
  } catch {
    return loadModelBytesWithoutPersistentCache(config, options)
  }

  const modelBytes = await loadModelBytesWithoutPersistentCache(config, options)

  try {
    await cache.put(cacheKey, new Response(modelBytes, {
      headers: {
        'content-type': 'application/octet-stream',
      },
    }))
    void pruneOldModelVersions(config)
  } catch {
    // Cache writes are optional. Fall back to using the fetched bytes directly.
  }

  return modelBytes
}

export async function clearOnnxModelStorageCache(modelId?: string): Promise<void> {
  if (!canUseCacheStorage()) {
    return
  }

  const cache = await caches.open(MODEL_CACHE_NAME)

  if (!modelId) {
    const keys = await cache.keys()
    await Promise.all(keys.map((request) => cache.delete(request)))
    return
  }

  const keys = await cache.keys()
  await Promise.all(
    keys
      .filter((request) => request.url.includes(`${MODEL_CACHE_PREFIX}/${modelId}/`))
      .map((request) => cache.delete(request)),
  )
}
