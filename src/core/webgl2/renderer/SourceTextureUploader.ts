import { TimelineItemQueries } from '@/core/timelineitem/queries'
import type { UnifiedTimelineItemData } from '@/core/timelineitem/model/timelineItem'
import type { MediaType, UnifiedMediaItemData } from '@/core/mediaitem/types'
import { areUnifiedTimeRangesEqual } from '@/core/types/timeRange'
import { WebGL2Runtime } from '@/core/webgl2/runtime/WebGL2Runtime'
import type { FrameData, TextureResource } from '@/core/webgl2/types'

type UploadableSource = ImageBitmap | VideoFrame

function getUploadableSourceSize(source: UploadableSource): { width: number; height: number } {
  if (source instanceof VideoFrame) {
    return {
      width: source.displayWidth,
      height: source.displayHeight,
    }
  }

  return {
    width: source.width,
    height: source.height,
  }
}

function getSourceTextureId(itemId: string): string {
  return `source:${itemId}`
}

/**
 * 单个时间轴 item 的 source texture 状态。
 *
 * `resource` 是 `TextureManager` 返回的同一个资源引用，GPU 资源的实际
 * 创建和删除仍然由 `TextureManager` 负责。这里同时保存上传判断所需的
 * source 元数据，避免再维护 itemId 到 textureId 的额外映射。
 */
interface SourceTextureEntryBase {
  resource: TextureResource
  width: number
  height: number
}

type SourceTextureEntry =
  | (SourceTextureEntryBase & {
      sourceKind: 'video'
      frameNumber: number
      timeRange: FrameData['timeRange']
    })
  | (SourceTextureEntryBase & {
      sourceKind: 'image'
      sourceRef: ImageBitmap
    })

/**
 * 把时间轴 item 的 source 数据同步到 GPU texture。
 *
 * 分工边界：
 * - 这个类负责“上传什么、什么时候重传”
 * - `TextureManager` 负责“texture 本身怎么创建和保存”
 */
export class SourceTextureUploader {
  private readonly entries = new Map<string, SourceTextureEntry>()

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
    if (TimelineItemQueries.isVideoTimelineItem(item)) {
      return this.uploadVideoTexture(item, bunnyCurFrameMap.get(item.id))
    }

    if (TimelineItemQueries.isImageTimelineItem(item)) {
      const mediaItem = this.getMediaItem(item.mediaItemId)
      return this.uploadStaticTexture(item.id, mediaItem?.runtime.bunny?.imageClip)
    }

    return null
  }

  /**
   * 返回 item 对应的稳定 source textureId。
   */
  getTextureIdForItem(itemId: string): string {
    return getSourceTextureId(itemId)
  }

  removeTexture(textureId: string): void {
    for (const [itemId, entry] of this.entries) {
      if (entry.resource.id === textureId) {
        this.entries.delete(itemId)
      }
    }

    this.runtime.textures.remove(textureId)
  }

  /**
   * 释放 uploader 自己维护的缓存关系，并同步删除对应的 source texture。
   */
  dispose(): void {
    for (const entry of this.entries.values()) {
      this.runtime.textures.remove(entry.resource.id)
    }
    this.entries.clear()
  }

  /**
   * 视频 source 的上传策略：
   * - 每帧从 `VideoSample` 生成一次短生命周期 `VideoFrame`
   * - 仅在 frameNumber 或时间轴片段范围变化时重新上传
   */
  private uploadVideoTexture(
    item: UnifiedTimelineItemData<'video'>,
    frameData?: FrameData,
  ): string | null {
    if (!frameData) {
      return null
    }

    const cached = this.entries.get(item.id)
    if (
      cached?.sourceKind === 'video' &&
      cached.frameNumber === frameData.frameNumber &&
      areUnifiedTimeRangesEqual(cached.timeRange, frameData.timeRange)
    ) {
      // 视频按 frameNumber 判定是否需要重新上传，避免每帧重复走 VideoFrame -> GPU。
      return cached.resource.id
    }

    const textureId = getSourceTextureId(item.id)
    const videoFrame = frameData.videoSample.toVideoFrame()
    try {
      const resource = this.runtime.textures.uploadSource(
        textureId,
        videoFrame,
        videoFrame.displayWidth,
        videoFrame.displayHeight,
      )
      this.entries.set(item.id, {
        resource,
        sourceKind: 'video',
        frameNumber: frameData.frameNumber,
        timeRange: { ...frameData.timeRange },
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
    itemId: string,
    source?: ImageBitmap,
  ): string | null {
    if (!source) {
      return null
    }

    const { width, height } = getUploadableSourceSize(source)

    const cached = this.entries.get(itemId)
    if (
      cached?.sourceKind === 'image' &&
      cached.sourceRef === source &&
      cached.width === width &&
      cached.height === height
    ) {
      // 图片和文本位图通常是稳定对象，直接按对象引用命中缓存即可。
      return cached.resource.id
    }

    const resource = this.runtime.textures.uploadSource(
      getSourceTextureId(itemId),
      source,
      width,
      height,
    )
    this.entries.set(itemId, {
      resource,
      sourceKind: 'image',
      sourceRef: source,
      width,
      height,
    })
    return resource.id
  }
}
