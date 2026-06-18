import type { UnifiedTimelineItemData } from '@/core/timelineitem/model/timelineItem'
import type { TransNetV2ProgressEvent } from './transnetv2/types'
import TransNetV2Worker from './transnetv2/transnetv2.worker.ts?worker'

export async function detectSceneTransNetV2(
  itemData: UnifiedTimelineItemData,
  file: File,
  config: {
    threshold?: number
    minShotFrames?: number
    signal?: AbortSignal
    onProgress?: (event: TransNetV2ProgressEvent) => void
  } = {},
): Promise<bigint[]> {
  if (typeof VideoFrame === 'undefined') {
    throw new Error('当前浏览器不支持 VideoFrame')
  }

  const timeRange = itemData.timeRange

  return new Promise<bigint[]>((resolve, reject) => {
    const worker = new TransNetV2Worker()

    let settled = false

    const cleanup = () => {
      worker.terminate()
      config.signal?.removeEventListener('abort', onAbort)
    }

    const onAbort = () => {
      if (!settled) {
        worker.postMessage({ type: 'abort' })
      }
    }

    config.signal?.addEventListener('abort', onAbort)

    worker.onmessage = (e: MessageEvent) => {
      const { type } = e.data

      if (type === 'progress') {
        config.onProgress?.(e.data.event as TransNetV2ProgressEvent)
      } else if (type === 'done') {
        settled = true
        cleanup()
        const boundaries: bigint[] = (e.data.boundaries as string[]).map((s) => BigInt(s))
        resolve(boundaries)
      } else if (type === 'error') {
        settled = true
        cleanup()
        if (e.data.message === '场景检测已取消') {
          reject(new DOMException(e.data.message, 'AbortError'))
        } else {
          reject(new Error(e.data.message))
        }
      }
    }

    worker.onerror = (e: ErrorEvent) => {
      settled = true
      cleanup()
      reject(new Error(e.message || 'Worker 执行出错'))
    }

    worker.postMessage({
      type: 'detect',
      file,
      timeRange: {
        timelineStartTime: timeRange.timelineStartTime,
        timelineEndTime: timeRange.timelineEndTime,
        clipStartTime: timeRange.clipStartTime,
        clipEndTime: timeRange.clipEndTime,
      },
      config: {
        threshold: config.threshold,
        minShotFrames: config.minShotFrames,
      },
    })
  })
}
