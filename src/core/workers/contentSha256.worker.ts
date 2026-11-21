import { hashBlob } from '../utils/hashBlob'

self.onmessage = async (event: MessageEvent<{ file?: Blob }>) => {
  try {
    if (!event.data?.file) throw new Error('缺少待计算哈希的文件')
    self.postMessage({ hash: await hashBlob(event.data.file) })
  } catch (error) {
    self.postMessage({ error: error instanceof Error ? error.message : String(error) })
  }
}
