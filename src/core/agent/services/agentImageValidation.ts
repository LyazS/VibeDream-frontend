import type { AgentToolImage } from '../types'
import { AGENT_MAX_IMAGE_EDGE, AGENT_MAX_IMAGE_ENCODED_BYTES } from '../constants/visual'

export {
  AGENT_MAX_IMAGE_COUNT,
  AGENT_MAX_IMAGE_EDGE,
  AGENT_MAX_IMAGE_ENCODED_BYTES,
  AGENT_MAX_IMAGE_ORIGINAL_BYTES,
  AGENT_MAX_IMAGE_PIXELS,
} from '../constants/visual'

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
      image.blob.size <= AGENT_MAX_IMAGE_ENCODED_BYTES &&
      ['image/png', 'image/jpeg', 'image/webp'].includes(image.blob.type) &&
      image.mimeType === image.blob.type &&
      image.byteSize === image.blob.size &&
      Number.isInteger(image.width) &&
      Number.isInteger(image.height) &&
      image.width! > 0 &&
      image.height! > 0 &&
      Math.max(image.width!, image.height!) <= AGENT_MAX_IMAGE_EDGE &&
      typeof image.description === 'string' &&
      image.description.trim(),
  )
}
