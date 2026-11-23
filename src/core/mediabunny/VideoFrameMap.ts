import type { FrameData } from '@/core/webgl2/types'

/**
 * 管理当前帧 Map 中保存的 VideoSample 生命周期。
 *
 * 传给 set() 的帧在被替换、删除或 Map 清空前都归 Map 持有。
 * 没有进入 Map 的帧仍由调用方持有，并由调用方负责关闭。
 */
export class VideoFrameMap extends Map<string, FrameData> {
  override set(itemId: string, frameData: FrameData): this {
    const oldFrame = this.get(itemId)
    if (oldFrame && oldFrame.videoSample !== frameData.videoSample) {
      oldFrame.videoSample.close()
    }

    return super.set(itemId, frameData)
  }

  override delete(itemId: string): boolean {
    const frameData = this.get(itemId)
    if (frameData) {
      frameData.videoSample.close()
    }

    return super.delete(itemId)
  }

  override clear(): void {
    for (const frameData of this.values()) {
      frameData.videoSample.close()
    }

    super.clear()
  }

  retain(itemIds: ReadonlySet<string>): void {
    for (const itemId of this.keys()) {
      if (!itemIds.has(itemId)) {
        this.delete(itemId)
      }
    }
  }
}
