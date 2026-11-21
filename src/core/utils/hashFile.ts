import { hashBlob } from './hashBlob'

export async function hashFile(file: Blob, signal?: AbortSignal): Promise<string> {
  signal?.throwIfAborted()
  if (typeof Worker === 'undefined') return hashBlob(file, signal)

  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('../workers/contentSha256.worker.ts', import.meta.url), {
      type: 'module',
    })
    const dispose = () => {
      signal?.removeEventListener('abort', abort)
      worker.terminate()
    }
    const abort = () => {
      dispose()
      reject(signal?.reason)
    }
    signal?.addEventListener('abort', abort, { once: true })
    worker.onmessage = (event: MessageEvent<{ hash?: string; error?: string }>) => {
      dispose()
      if (event.data.hash) resolve(event.data.hash)
      else reject(new Error(event.data.error || 'SHA-256 计算失败'))
    }
    worker.onerror = (event) => {
      dispose()
      reject(event.error || new Error('SHA-256 Worker 失败'))
    }
    try {
      worker.postMessage({ file })
    } catch (error) {
      dispose()
      reject(error)
    }
  })
}
