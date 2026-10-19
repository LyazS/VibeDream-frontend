import { useUnifiedStore } from '@/core/unifiedStore'
import { AgentSessionStore } from '../runtime/AgentSessionStore'
import { AgentImageSourceError, readAgentImageSource } from '../services/agentImageService'
import { createMediaFileImportService } from '@/core/media-import/MediaFileImportService'
import { MediaItemQueries } from '@/core/mediaitem/queries'
import type { ToolDefinition, ToolExecutionContext } from './types'
import { buildToolError, buildToolException, buildToolSuccess } from './utils/result'

export async function executeImportAttachment(
  args: Record<string, unknown>,
  context: ToolExecutionContext,
) {
  const { attachmentId, targetDirectoryId } = args
  if (
    typeof attachmentId !== 'string' ||
    !attachmentId.trim() ||
    (targetDirectoryId !== undefined &&
      (typeof targetDirectoryId !== 'string' || !targetDirectoryId.trim()))
  ) {
    return buildToolError(
      'import_attachment',
      'invalid_arguments',
      'attachmentId 必须是非空字符串；targetDirectoryId 如有提供，也必须是非空字符串。',
    )
  }

  try {
    const store = useUnifiedStore()
    const assertCurrent = () => {
      context.signal.throwIfAborted()
      if (!context.isCurrent() || store.projectId !== context.projectId) {
        throw Object.assign(new Error('附件导入的执行归属已失效。'), {
          toolCode: 'context_expired',
        })
      }
    }
    assertCurrent()
    // 读取执行所属会话的已提交用户引用，不能随 UI 当前选中的会话变化。
    const image = await new AgentSessionStore().readImage(
      { id: context.sessionId, userId: context.userId, projectId: context.projectId },
      attachmentId,
      { requireUserReference: true },
    )
    assertCurrent()
    if (!image) {
      return buildToolError(
        'import_attachment',
        'attachment_not_found',
        '当前执行会话未引用这张用户图片附件。请使用该会话中图片的 attachmentId。',
      )
    }
    if (targetDirectoryId !== undefined && !store.getDirectory(targetDirectoryId as string)) {
      return buildToolError('import_attachment', 'directory_not_found', '目标素材目录不存在。')
    }

    // 必须复制原图字节；有效的上传地址和运行时模型小图都不能替代原图。
    const original = await readAgentImageSource(image)
    assertCurrent()
    const file = new File([original], image.original.fileName, { type: image.original.mimeType })
    const media = await createMediaFileImportService(store).importFile(
      file,
      targetDirectoryId as string | undefined,
      {
        waitUntilReady: true,
        projectId: context.projectId,
        signal: context.signal,
        isCurrent: context.isCurrent,
      },
    )
    assertCurrent()
    const size = MediaItemQueries.getOriginalSize(media)
    if (media.mediaType !== 'image' || !size) {
      return buildToolError('import_attachment', 'import_failed', '未能完成原图解码。')
    }
    return buildToolSuccess('import_attachment', {
      attachmentId,
      mediaId: media.id,
      mediaType: 'image',
      ...size,
    })
  } catch (error) {
    if (context.signal.aborted || (error instanceof Error && error.name === 'AbortError')) {
      return buildToolError('import_attachment', 'cancelled', '附件导入已取消。')
    }
    if (error instanceof AgentImageSourceError && error.code === 'AGENT_IMAGE_SOURCE_MISSING') {
      return buildToolError('import_attachment', 'file_missing', '工程中的附件原图已不存在。')
    }
    return buildToolException('import_attachment', error)
  }
}

export const importAttachmentTool: ToolDefinition = {
  name: 'import_attachment',
  execute: executeImportAttachment,
}
