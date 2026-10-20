import { FRAME_RATE } from '@/constants/TimeConstants'
import {
  AGENT_MAX_IMAGE_COUNT,
  AGENT_VIEW_DEFAULT_FRAME_COUNT,
  AGENT_VIEW_MAX_FRAME_COUNT,
  AGENT_VIEW_MAX_ITEMS,
  AGENT_VIEW_MIN_FRAME_COUNT,
} from '../../constants/visual'
import type { ModelTool } from '../../transport/AgentClient'

/** 素材观察的时间码采用统一帧率；实际时长和静态图片限制由执行器校验。 */
const timecode = { type: 'string', pattern: '^\\d{2}:[0-5]\\d:[0-5]\\d\\+[0-2]\\d$' }
const viewOptionProperties = {
  region: {
    type: 'object',
    additionalProperties: false,
    properties: {
      x: { type: 'number', minimum: 0, maximum: 1 },
      y: { type: 'number', minimum: 0, maximum: 1 },
      width: { type: 'number', exclusiveMinimum: 0, maximum: 1 },
      height: { type: 'number', exclusiveMinimum: 0, maximum: 1 },
    },
    required: ['x', 'y', 'width', 'height'],
  },
  at: timecode,
  timeRange: {
    type: 'object',
    additionalProperties: false,
    properties: {
      start: timecode,
      end: timecode,
      frameCount: {
        type: 'integer',
        minimum: AGENT_VIEW_MIN_FRAME_COUNT,
        maximum: AGENT_VIEW_MAX_FRAME_COUNT,
      },
    },
    required: ['start', 'end'],
  },
}

/** 定义素材观察参数：来源互斥，单帧与时间范围最多选择一种。 */
function viewMediaParameters() {
  return {
    type: 'object',
    additionalProperties: false,
    required: ['items'],
    properties: {
      items: {
        type: 'array',
        minItems: 1,
        maxItems: AGENT_VIEW_MAX_ITEMS,
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            ...viewOptionProperties,
            source: {
              oneOf: ['attachment', 'media'].map((kind) => ({
                type: 'object',
                additionalProperties: false,
                properties: {
                  kind: { const: kind },
                  [`${kind}Id`]: { type: 'string', minLength: 1, pattern: '^\\S+$' },
                },
                required: ['kind', `${kind}Id`],
              })),
            },
          },
          required: ['source'],
          not: { required: ['at', 'timeRange'] },
        },
      },
    },
  }
}

const viewMediaInstructions = `每次 1～${AGENT_VIEW_MAX_ITEMS} 个 items，合计最多 ${AGENT_MAX_IMAGE_COUNT} 张图，范围按 frameCount（默认 ${AGENT_VIEW_DEFAULT_FRAME_COUNT}，整数 ${AGENT_VIEW_MIN_FRAME_COUNT}～${AGENT_VIEW_MAX_FRAME_COUNT}）预留预算。
region 是相对于完整正常显示画面的归一化矩形，左上原点，先裁剪再缩放；不可越界。
静态图片禁止时间参数；视频必须选择 at 或 timeRange 之一。
时间码严格 HH:MM:SS+FF，${FRAME_RATE} fps。at 满足 0 <= at < duration，timeRange 为 [start,end)，end <= duration。
范围等距抽帧并去重，短区间可能返回更少图片。结果为带独立图片 ID、逐图时间码和区域说明的图文工具消息。
只读观察，不改变播放头、播放状态、素材或时间轴。历史图片是当次观察的固定结果。`

/** 提供给模型的素材观察工具契约，说明来源、裁剪及图片引用的使用边界。 */
export const viewMediaDefinition: ModelTool = {
  name: 'view_media',
  description: `查看当前执行会话引用的用户图片附件，或当前工程素材库的图片/视频原始画面。
source 严格选择 {kind:'attachment',attachmentId} 或 {kind:'media',mediaId}，使用完整原始 ID。
视频时间相对于原素材起点，不受时间轴裁切、移动和变速影响。用 view_timeline 查看最终合成。
图片用于剪辑时用 import_attachment 导入完整原图，再用返回的 mediaId 调用 insert_clip；观察图片 ID 不可作为素材 ID。
${viewMediaInstructions}`,
  parameters: viewMediaParameters(),
}
