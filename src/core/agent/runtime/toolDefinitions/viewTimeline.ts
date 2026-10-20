import { AGENT_VIEW_DEFAULT_FRAME_COUNT } from '@/constants/AgentConstants'
import type { ModelTool } from '../../transport/AgentClient'

/** 时间轴采用 30 fps 的绝对时间码；工程有效时长由执行器校验。 */
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
      frameCount: { type: 'integer', minimum: 2, maximum: 4 },
    },
    required: ['start', 'end'],
  },
}

/** 定义时间轴观察参数：每个目标必须在单帧与时间范围之间选择一种。 */
function viewTimelineParameters() {
  return {
    type: 'object',
    additionalProperties: false,
    required: ['items'],
    properties: {
      items: {
        type: 'array',
        minItems: 1,
        maxItems: 4,
        items: {
          type: 'object',
          additionalProperties: false,
          properties: viewOptionProperties,
          oneOf: [{ required: ['at'] }, { required: ['timeRange'] }],
        },
      },
    },
  }
}

const viewTimelineInstructions = `每次 1～4 个 items，合计最多 4 张图，范围按 frameCount（默认 ${AGENT_VIEW_DEFAULT_FRAME_COUNT}，整数 2～4）预留预算。
region 是相对于完整工程画布的归一化矩形，左上原点，先裁剪再缩放；不可越界。
时间轴必须选择 at 或 timeRange 之一；时间码严格 HH:MM:SS+FF，30 fps。at 满足 0 <= at < duration，timeRange 为 [start,end)，end <= duration。
范围等距抽帧并去重，短区间可能返回更少图片。结果为带独立图片 ID、逐图时间码和区域说明的图文工具消息。
所有帧来自同一份固定工程快照；只读观察，不改变播放头、播放状态、素材或时间轴。历史图片是当次观察的固定结果。`

/** 提供给模型的时间轴观察工具契约，所有图片来自同一次调用的工程快照。 */
export const viewTimelineDefinition: ModelTool = {
  name: 'view_timeline',
  description: `查看当前工程时间轴的最终合成画面，含可见轨道、字幕、动画、滤镜和转场。
items 不带 source，时间为时间轴绝对时间，region 相对于完整工程画布。同次所有帧来自固定工程快照。
${viewTimelineInstructions}`,
  parameters: viewTimelineParameters(),
}
