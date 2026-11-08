import {
  AGENT_MAX_IMAGE_COUNT,
  AGENT_VIEW_DEFAULT_FRAME_COUNT,
  AGENT_VIEW_MAX_FRAME_COUNT,
  AGENT_VIEW_MAX_ITEMS,
  AGENT_VIEW_MIN_FRAME_COUNT,
} from '../../constants/visual'
import type { ModelTool } from '../../transport/AgentClient'

const timecode = {
  type: 'string',
  pattern: '^\\d{2}:[0-5]\\d:[0-5]\\d\\+[0-2]\\d$',
  description: '时间码，格式 HH:MM:SS+FF，固定 30 FPS。',
}

const viewOptionProperties = {
  region: {
    type: 'object',
    additionalProperties: false,
    description: '相对于完整正常显示画面的归一化裁剪矩形；左上角为原点，先裁剪再缩放。',
    properties: {
      x: { type: 'number', minimum: 0, maximum: 1, description: '左边界，范围 0～1。' },
      y: { type: 'number', minimum: 0, maximum: 1, description: '上边界，范围 0～1。' },
      width: { type: 'number', exclusiveMinimum: 0, maximum: 1, description: '裁剪宽度。' },
      height: { type: 'number', exclusiveMinimum: 0, maximum: 1, description: '裁剪高度。' },
    },
    required: ['x', 'y', 'width', 'height'],
  },
  at: { ...timecode, description: '查看单帧的原素材相对时间。' },
  timeRange: {
    type: 'object',
    additionalProperties: false,
    description: '半开时间范围 [start, end)，等距采样视频帧。',
    properties: {
      start: { ...timecode, description: '采样起点，包含这一帧。' },
      end: { ...timecode, description: '采样终点，不包含这一帧。' },
      frameCount: {
        type: 'integer',
        minimum: AGENT_VIEW_MIN_FRAME_COUNT,
        maximum: AGENT_VIEW_MAX_FRAME_COUNT,
        description: `采样帧数，省略时默认为 ${AGENT_VIEW_DEFAULT_FRAME_COUNT}；不是输出图片数量。`,
      },
    },
    required: ['start', 'end'],
  },
}

const sourceSchema = {
  oneOf: ['attachment', 'media'].map((kind) => ({
    type: 'object',
    additionalProperties: false,
    properties: {
      kind: {
        const: kind,
        description: kind === 'attachment' ? '当前会话用户图片附件。' : '当前工程素材库素材。',
      },
      [`${kind}Id`]: {
        type: 'string',
        minLength: 1,
        pattern: '^\\S+$',
        description:
          kind === 'attachment'
            ? '完整 attachmentId；不能传 mediaId、路径或临时 URL。'
            : '完整 mediaId；必须来自 list_media、search_media、read_media 或 import_attachment。',
      },
    },
    required: ['kind', `${kind}Id`],
  })),
  description: '观察来源。attachmentId 和 mediaId 是不同身份，不能互换。',
}

function viewMediaParameters() {
  return {
    type: 'object',
    additionalProperties: false,
    properties: {
      items: {
        type: 'array',
        minItems: 1,
        maxItems: AGENT_VIEW_MAX_ITEMS,
        description: `观察目标数组，最多 ${AGENT_VIEW_MAX_ITEMS} 项；每项最多产生一张输出图。`,
        items: {
          type: 'object',
          additionalProperties: false,
          properties: { source: sourceSchema, ...viewOptionProperties },
          required: ['source'],
          not: { required: ['at', 'timeRange'] },
        },
      },
    },
    required: ['items'],
  }
}

export const viewMediaDefinition: ModelTool = {
  name: 'view_media',
  description: `What It Does
-------------
查看当前会话引用的用户图片附件，或当前工程素材库中的图片/视频原始画面。

Use When
---------
- 用户需要确认素材原始画面、视频内容或某个素材时间段
- 需要在编辑前观察素材，而不是查看时间轴最终合成结果

Do NOT Use When
---------------
- 需要查看字幕、滤镜、动画、转场或多轨叠加后的最终画面时，应使用 view_timeline
- 需要读取素材名称、尺寸、时长、摘要或分镜时，应使用 read_media
- 需要把聊天图片加入素材库时，应使用 import_attachment

Input Semantics
---------------
- source 必须选择 attachment 或 media，使用完整原始 ID；两种身份不能互换。
- 静态图片不能提供 at 或 timeRange；视频必须提供其中一个，两者不能同时提供。
- 视频时间是原素材相对时间，不受时间轴裁切、移动和变速影响。
- at 视频返回一张单帧图；timeRange 视频每个 item 返回一张带时间码的 contact sheet。
- 每次 1～${AGENT_VIEW_MAX_ITEMS} 个 items，最多返回 ${AGENT_MAX_IMAGE_COUNT} 张输出图；范围默认采样 ${AGENT_VIEW_DEFAULT_FRAME_COUNT} 帧，允许 ${AGENT_VIEW_MIN_FRAME_COUNT}～${AGENT_VIEW_MAX_FRAME_COUNT} 帧。
- region 使用完整正常显示画面的归一化坐标，先裁剪再缩放；时间码为 HH:MM:SS+FF，固定 30 FPS，timeRange 为半开区间 [start,end)。
- 如果不知道视频时长，先调用 read_media 获取 basic.duration；收到时间范围越界错误时，使用错误中返回的有效时长重试。

Returns
-------
- 工具文本会说明来源、时间范围、采样间隔、网格和裁剪区域。
- 观察画面以独立图片附件返回；图片 ID 只引用本次观察，不能用于 insert_clip 或 import_attachment。
- contact sheet 按行优先排列，每个画面下方标注采样时间码，空白格没有时间码。

Limitations
-----------
只读观察，不改变播放头、播放状态、素材或时间轴。历史观察图片是当次调用的固定结果；离散采样不能据此声称完整观看了整段视频。`,
  parameters: viewMediaParameters(),
}
