import type { AgentToolImage } from '../types'

/** 单次模型请求中，用户附件与工具观察图共用的历史图片预算。 */
export const AGENT_VISUAL_CONTEXT_IMAGE_LIMIT = 12

/** 原图接收、解码和观察图编码的限制；与模型历史图片预算分别校验。 */
export const AGENT_IMAGE_LIMITS = {
  // 单次用户提交或工具调用最多携带的图片数。
  count: 4,
  originalBytes: 10 * 1024 * 1024,
  pixels: 40_000_000,
  edge: 2048,
  encodedBytes: 2 * 1024 * 1024,
} as const

/** 校验工具图片的归属、格式、尺寸及 Blob 元数据，拒绝不完整的存储记录。 */
export function isAgentToolImage(value: unknown): value is AgentToolImage {
  const image = value as Partial<AgentToolImage> | undefined
  return Boolean(
    image?.recordKind === 'tool_image' &&
      typeof image.id === 'string' &&
      image.id &&
      typeof image.userId === 'string' &&
      image.userId &&
      typeof image.projectId === 'string' &&
      image.projectId &&
      image.blob instanceof Blob &&
      image.blob.size > 0 &&
      image.blob.size <= AGENT_IMAGE_LIMITS.encodedBytes &&
      ['image/png', 'image/jpeg', 'image/webp'].includes(image.blob.type) &&
      image.mimeType === image.blob.type &&
      image.byteSize === image.blob.size &&
      Number.isInteger(image.width) &&
      Number.isInteger(image.height) &&
      image.width! > 0 &&
      image.height! > 0 &&
      Math.max(image.width!, image.height!) <= AGENT_IMAGE_LIMITS.edge &&
      typeof image.description === 'string' &&
      image.description.trim(),
  )
}
