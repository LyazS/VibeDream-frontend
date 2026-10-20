import { useUnifiedStore } from '@/core/unifiedStore'
import { framesToTimecode } from '@/core/utils/timeUtils'
import { abortable } from '@/core/utils/abortable'
import { AgentSessionStore } from '../runtime/AgentSessionStore'
import { readAgentImageSource } from '../services/agentImageService'
import type { ToolDefinition, ToolExecutionContext, ToolImageInput, ToolResult } from './types'
import {
  parseViewMediaItems,
  runViewTool,
  viewError,
  viewSampleFrames,
  type ViewExecution,
  type ViewMediaItem,
  type ViewOptions,
} from './viewShared'

/** 查看原始附件或素材；时间、解码及素材归属都以执行上下文为准。 */
export function executeViewMedia(
  args: Record<string, unknown>,
  context: ToolExecutionContext,
): Promise<ToolResult> {
  const store = useUnifiedStore()
  return runViewTool<ViewMediaItem>(
    'view_media',
    context,
    () => store.projectId,
    (view) => ({
      items: parseViewMediaItems(args),
      identify: ({ source }) => (source.kind === 'media' ? source.mediaId : source.attachmentId),
      read: (item) => readMedia(item, view),
    }),
  )

  /** 此处创建的位图由本次读取负责释放，取消后迟到的位图也必须关闭。 */
  async function readBitmap(
    blob: Blob,
    item: ViewOptions,
    description: string,
    view: ViewExecution,
  ): Promise<ToolImageInput[]> {
    const bitmap = await abortable(
      createImageBitmap(blob, { imageOrientation: 'from-image' }),
      view.signal,
      (late) => late.close(),
    )
    try {
      return [await view.encode(bitmap, bitmap.width, bitmap.height, item, description)]
    } finally {
      bitmap.close()
    }
  }

  /** 每个目标独立读取；任意必要帧失败时丢弃该目标此前编码的所有帧。 */
  async function readMedia(item: ViewMediaItem, view: ViewExecution): Promise<ToolImageInput[]> {
    const { signal, check, encode } = view
    const source = item.source
    if (source.kind === 'attachment') {
      // 附件来源必须是本会话用户消息引用的原图，工具观察图不能作为用户附件读取。
      if (item.at !== undefined || item.timeRange)
        throw viewError('invalid_arguments', '静态图片不能指定时间。')
      const image = await abortable(
        new AgentSessionStore().readImage(
          { id: context.sessionId, userId: context.userId, projectId: context.projectId },
          source.attachmentId,
          { requireUserReference: true },
        ),
        signal,
      )
      check()
      if (!image || image.recordKind !== 'user_attachment')
        throw viewError('attachment_not_found', `当前会话未引用用户图片 ${source.attachmentId}。`)
      const blob = await abortable(readAgentImageSource(image), signal)
      check()
      return readBitmap(
        blob,
        item,
        `附件 ${source.attachmentId}（${image.original.fileName}）`,
        view,
      )
    }
    const media = store.getMediaItem(source.mediaId)
    if (!media) throw viewError('media_not_found', `未找到素材 ${source.mediaId}。`)
    if (media.mediaType !== 'image' && media.mediaType !== 'video')
      throw viewError('unsupported_media_type', '仅支持图片或视频素材。')
    if (media.mediaType === 'image' && (item.at !== undefined || item.timeRange))
      throw viewError('invalid_arguments', '静态图片不能指定时间。')
    if (media.mediaType === 'video' && !item.at && !item.timeRange)
      throw viewError('invalid_arguments', '视频必须指定 at 或 timeRange。')
    const name = media.name
    await abortable(store.ensureMediaReady(media.id), signal)
    check()
    if (store.getMediaItem(source.mediaId) !== media)
      throw viewError('context_expired', '素材已被替换或移除。')
    if (media.mediaStatus === 'missing') throw viewError('file_missing', '素材原文件已不存在。')
    if (media.mediaType === 'image') {
      // 素材库位图由素材运行时持有，此处仅借用绘制，不关闭共享资源。
      const bitmap = media.runtime.bunny?.imageClip
      if (!bitmap) throw viewError('frame_unavailable', '素材图片未能解码。')
      return [
        await encode(
          bitmap,
          bitmap.width,
          bitmap.height,
          item,
          `素材 ${source.mediaId}（${name}）`,
        ),
      ]
    }
    const bunny = media.runtime.bunny?.bunnyMedia
    if (!bunny) throw viewError('frame_unavailable', '视频解码器不可用。')
    const range = await abortable(bunny.getVideoDisplayRange(), signal)
    check()
    const frames = viewSampleFrames(item, (range.end - range.start) * 30)
    const getSample = bunny.videoGetSample()
    if (!getSample) throw viewError('frame_unavailable', '素材没有可用视频轨道。')
    const timestamps = new Set<number>(),
      results: ToolImageInput[] = []
    for (const frame of frames) {
      check()
      // 原素材时间从首个可显示时间戳起算，不能直接把相对时间当成解码时间戳。
      const at = range.start + frame / 30
      const sample = await abortable(getSample(at), signal, (late) => late?.close())
      try {
        check()
        if (
          !sample ||
          at + 1e-6 < sample.timestamp ||
          at >= sample.timestamp + sample.duration + 1e-6
        )
          throw viewError('frame_unavailable', `at=${framesToTimecode(frame)} 没有可用视频帧。`)
        // 多个编辑帧可能命中同一视频帧，按实际解码时间戳去重。
        if (timestamps.has(sample.timestamp)) continue
        timestamps.add(sample.timestamp)
        results.push(
          await encode(
            (ctx, crop) =>
              sample.drawWithFit(ctx, {
                fit: 'fill',
                crop: { left: crop.x, top: crop.y, width: crop.width, height: crop.height },
              }),
            sample.displayWidth,
            sample.displayHeight,
            item,
            `素材 ${source.mediaId}（${name}），at=${framesToTimecode(frame)}`,
          ),
        )
      } finally {
        sample?.close()
      }
    }
    return results
  }
}

export const viewMediaTool: ToolDefinition = {
  name: 'view_media',
  execute: executeViewMedia,
}
