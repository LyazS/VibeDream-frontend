import type { AgentToolImage } from '../types'
import type { ToolExecutionContext, ToolResult } from '../tools/types'
import { AGENT_MAX_IMAGE_COUNT, isAgentToolImage } from '../services/agentImageValidation'

/** 暂存单次工具调用的观察图片；只有被结果按顺序引用的图片才能交给存储层。 */
export function createToolImageStaging(
  context: Pick<ToolExecutionContext, 'userId' | 'projectId' | 'signal' | 'isCurrent'>,
) {
  const images: AgentToolImage[] = []
  let closed = false
  const stageImage: NonNullable<ToolExecutionContext['stageImage']> = (input) => {
    context.signal.throwIfAborted()
    if (closed || !context.isCurrent()) throw new Error('TOOL_CONTEXT_EXPIRED')
    // 图片身份和归属由运行时填写，工具只提供编码结果和画面描述。
    const image: AgentToolImage = {
      ...input,
      id: crypto.randomUUID(),
      userId: context.userId,
      projectId: context.projectId,
      recordKind: 'tool_image',
      mimeType: input.blob.type as AgentToolImage['mimeType'],
      byteSize: input.blob.size,
    }
    if (!isAgentToolImage(image) || images.length >= AGENT_MAX_IMAGE_COUNT)
      throw new Error('INVALID_TOOL_IMAGE')
    images.push(image)
    return { type: 'image', image: { id: image.id } }
  }
  return {
    stageImage,
    /** 结果只能引用本次调用的图片，并保持生成顺序；取出后立即关闭暂存区。 */
    take(result: ToolResult): AgentToolImage[] {
      context.signal.throwIfAborted()
      if (closed || !context.isCurrent()) throw new Error('TOOL_CONTEXT_EXPIRED')
      const refs = result.attachIds ?? []
      let previous = -1
      const selected: AgentToolImage[] = []
      if (!result.success && refs.length) throw new Error('INVALID_TOOL_IMAGE_REFERENCES')
      for (const ref of refs) {
        const index =
          ref?.type === 'image' ? images.findIndex((image) => image.id === ref.image?.id) : -1
        // 索引必须严格递增，同时拒绝外部图片、重复引用和倒序引用。
        if (index <= previous) throw new Error('INVALID_TOOL_IMAGE_REFERENCES')
        previous = index
        selected.push(images[index]!)
      }
      closed = true
      images.length = 0
      return selected
    },
    /** 无论执行是否成功，都释放尚未提交的图片引用，并拒绝后续暂存。 */
    dispose() {
      closed = true
      images.length = 0
    },
  }
}
