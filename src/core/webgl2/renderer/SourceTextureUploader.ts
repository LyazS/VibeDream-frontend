import { TimelineItemQueries } from '@/core/timelineitem/queries'
import type { UnifiedTimelineItemData } from '@/core/timelineitem/type'
import type { MediaType, UnifiedMediaItemData } from '@/core/mediaitem/types'
import { WebGL2Runtime } from '@/core/webgl2/runtime/WebGL2Runtime'
import type { FrameData } from '@/core/webgl2/types'

type UploadableSource = ImageBitmap | VideoFrame

/**
 * source texture 的 CPU 侧缓存记录。
 *
 * 这里只缓存“是否需要重新上传”的判断依据，不持有 GPU 所有权；
 * GPU texture 仍然由 `TextureManager` 统一管理。
 */
interface UploadEntry {
  objectRef: UploadableSource | null
  frameNumber?: number
  contentVersion?: number
  width: number
  height: number
}

/**
 * 把时间轴 item 的 source 数据同步到 GPU texture。
 *
 * 分工边界：
 * - 这个类负责“上传什么、什么时候重传”
 * - `TextureManager` 负责“texture 本身怎么创建和保存”
 */
export class SourceTextureUploader {
  private readonly cache = new Map<string, UploadEntry>()
  private readonly sourceTextureIds = new Map<string, string | null>()

  constructor(
    private readonly runtime: WebGL2Runtime,
    private readonly getMediaItem: (mediaItemId: string) => UnifiedMediaItemData | undefined,
  ) {}

  /**
   * 为单个 item 准备 source texture，并返回逻辑 textureId。
   */
  ensureTextureForItem(
    item: UnifiedTimelineItemData<MediaType>,
    bunnyCurFrameMap: Map<string, FrameData>,
  ): string | null {
    let textureId: string | null = null

    if (TimelineItemQueries.isVideoTimelineItem(item)) {
      textureId = this.uploadVideoTexture(item, bunnyCurFrameMap.get(item.id))
    } else if (TimelineItemQueries.isTextTimelineItem(item)) {
      textureId = this.uploadStaticTexture(
        `text:${item.id}`,
        item.runtime.textBitmap,
        item.runtime.textBitmapVersion,
      )
    } else if (TimelineItemQueries.isImageTimelineItem(item)) {
      const mediaItem = this.getMediaItem(item.mediaItemId)
      textureId = this.uploadStaticTexture(`image:${item.id}`, mediaItem?.runtime.bunny?.imageClip)
    }

    this.sourceTextureIds.set(item.id, textureId)
    return textureId
  }

  /**
   * 返回当前 item 绑定的 source textureId。
   */
  getTextureIdForItem(itemId: string): string | null {
    return this.sourceTextureIds.get(itemId) || null
  }

  /**
   * 释放 uploader 自己维护的缓存关系，并同步删除对应的 source texture。
   */
  dispose(): void {
    for (const textureId of this.cache.keys()) {
      this.runtime.textures.remove(textureId)
    }
    this.cache.clear()
    this.sourceTextureIds.clear()
  }

  /**
   * 视频 source 的上传策略：
   * - 每帧从 `VideoSample` 生成一次短生命周期 `VideoFrame`
   * - 仅在 frameNumber 变化时重新上传
   */
  private uploadVideoTexture(
    item: UnifiedTimelineItemData<'video'>,
    frameData?: FrameData,
  ): string | null {
    if (!frameData) {
      return null
    }

    const textureId = `video:${item.id}`
    const cached = this.cache.get(textureId)
    if (cached?.frameNumber === frameData.frameNumber) {
      // 视频按 frameNumber 判定是否需要重新上传，避免每帧重复走 VideoFrame -> GPU。
      return textureId
    }

    const videoFrame = frameData.videoSample.toVideoFrame()
    try {
      this.runtime.textures.uploadSource(textureId, videoFrame, videoFrame.displayWidth, videoFrame.displayHeight)
      this.cache.set(textureId, {
        objectRef: videoFrame,
        frameNumber: frameData.frameNumber,
        width: videoFrame.displayWidth,
        height: videoFrame.displayHeight,
      })
      return textureId
    } finally {
      // VideoFrame 生命周期很短，上传结束立即 close，避免积累浏览器底层视频资源。
      videoFrame.close()
    }
  }

  /**
   * 图片和文本位图的上传策略：
   * - 同一个对象引用可视为同一份静态内容
   * - 尺寸变化会触发重新上传
   */
  private uploadStaticTexture(
    textureId: string,
    source?: ImageBitmap,
    contentVersion?: number,
  ): string | null {
    if (!source) {
      return null
    }

    const cached = this.cache.get(textureId)
    if (
      cached?.objectRef === source &&
      cached.contentVersion === contentVersion &&
      cached.width === source.width &&
      cached.height === source.height
    ) {
      // 图片和文本位图通常是稳定对象，直接按对象引用命中缓存即可。
      return textureId
    }

    this.runtime.textures.uploadSource(textureId, source, source.width, source.height)
    this.cache.set(textureId, {
      objectRef: source,
      contentVersion,
      width: source.width,
      height: source.height,
    })
    return textureId
  }
}
