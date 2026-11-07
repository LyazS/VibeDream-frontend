import { sha256 } from '@noble/hashes/sha2.js'
import { bytesToHex } from '@noble/hashes/utils.js'

const HASH_CHUNK_SIZE = 4 * 1024 * 1024

async function hashBlob(blob: Blob): Promise<string> {
  const hasher = sha256.create()
  if (typeof blob.stream === 'function') {
    const reader = blob.stream().getReader()
    try {
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        hasher.update(value)
      }
    } finally {
      reader.releaseLock()
    }
  } else {
    for (let offset = 0; offset < blob.size; offset += HASH_CHUNK_SIZE) {
      const chunk = await blob.slice(offset, offset + HASH_CHUNK_SIZE).arrayBuffer()
      hasher.update(new Uint8Array(chunk))
    }
  }
  return bytesToHex(hasher.digest())
}

self.onmessage = async (event: MessageEvent<{ file?: Blob }>) => {
  try {
    if (!event.data?.file) throw new Error('缺少待计算哈希的文件')
    self.postMessage({ hash: await hashBlob(event.data.file) })
  } catch (error) {
    self.postMessage({ error: error instanceof Error ? error.message : String(error) })
  }
}
