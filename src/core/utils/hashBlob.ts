import { sha256 } from '@noble/hashes/sha2.js'
import { bytesToHex } from '@noble/hashes/utils.js'

const CHUNK_SIZE = 4 * 1024 * 1024

export async function hashBlob(blob: Blob, signal?: AbortSignal): Promise<string> {
  signal?.throwIfAborted()
  const hasher = sha256.create()
  if (typeof blob.stream === 'function') {
    const reader = blob.stream().getReader()
    const abort = () => void reader.cancel().catch(() => {})
    signal?.addEventListener('abort', abort, { once: true })
    try {
      while (true) {
        const { done, value } = await reader.read()
        signal?.throwIfAborted()
        if (done) break
        hasher.update(value)
      }
    } finally {
      signal?.removeEventListener('abort', abort)
      reader.releaseLock()
    }
  } else {
    for (let offset = 0; offset < blob.size; offset += CHUNK_SIZE) {
      const chunk = await blob.slice(offset, offset + CHUNK_SIZE).arrayBuffer()
      signal?.throwIfAborted()
      hasher.update(new Uint8Array(chunk))
    }
  }
  return bytesToHex(hasher.digest())
}
