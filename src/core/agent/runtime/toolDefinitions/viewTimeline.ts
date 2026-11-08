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
  description: '时间码，格式 HH:MM:SS+FF，固定 30 FPS。时间轴使用绝对时间。',
}

const viewOptionProperties = {
  region: {
    type: 'object',
    additionalProperties: false,
    description: '相对于完整工程画布的归一化裁剪矩形；左上角为原点，先裁剪再缩放。',
    properties: {
      x: { type: 'number', minimum: 0, maximum: 1, description: '左边界，范围 0～1。' },
      y: { type: 'number', minimum: 0, maximum: 1, description: '上边界，范围 0～1。' },
      width: { type: 'number', exclusiveMinimum: 0, maximum: 1, description: '裁剪宽度。' },
      height: { type: 'number', exclusiveMinimum: 0, maximum: 1, description: '裁剪高度。' },
    },
    required: ['x', 'y', 'width', 'height'],
  },
  at: { ...timecode, description: '查看单帧的时间轴绝对时间。' },
  timeRange: {
    type: 'object',
    additionalProperties: false,
    description: '半开时间范围 [start, end)，等距采样时间轴最终画面。',
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

function viewTimelineParameters() {
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
          properties: viewOptionProperties,
          oneOf: [{ required: ['at'] }, { required: ['timeRange'] }],
        },
      },
    },
    required: ['items'],
  }
}

export const viewTimelineDefinition: ModelTool = {
  name: 'view_timeline',
  description: `What It Does
-------------
查看当前工程时间轴的最终合成画面，包含可见轨道、字幕、动画、滤镜和转场。

Use When
---------
- 用户需要检查剪辑后的最终视觉结果
- 需要确认多轨叠加、字幕、动画、滤镜或转场的实际效果
- 需要在修改时间轴后验证合成画面

Do NOT Use When
---------------
- 需要查看素材原始画面时，应使用 view_media
- 需要读取轨道、clip 或属性结构时，应使用 list_tracks、read_tracks 或 read_item

Input Semantics
---------------
- items 不带 source；时间使用时间轴绝对时间。
- 每项必须选择 at 或 timeRange，不能同时提供。
- at 返回一张单帧图；timeRange 每个 item 返回一张带时间轴时间码的 contact sheet。
- 每次 1～${AGENT_VIEW_MAX_ITEMS} 个 items，最多返回 ${AGENT_MAX_IMAGE_COUNT} 张输出图；范围默认采样 ${AGENT_VIEW_DEFAULT_FRAME_COUNT} 帧，允许 ${AGENT_VIEW_MIN_FRAME_COUNT}～${AGENT_VIEW_MAX_FRAME_COUNT} 帧。
- region 使用完整工程画布的归一化坐标，先裁剪再缩放；时间码为 HH:MM:SS+FF，固定 30 FPS，timeRange 为半开区间 [start,end)。
- 所有帧来自同一份固定工程快照；工具不会改变播放头、播放状态、素材或时间轴。

Returns
-------
- 工具文本会说明时间范围、采样间隔、网格和裁剪区域。
- 最终合成画面以独立图片附件返回；图片 ID 只引用本次观察，不能用于 insert_clip 或 import_attachment。
- contact sheet 按行优先排列，每个画面下方标注时间轴绝对时间码，空白格没有时间码。

Limitations
-----------
范围观察是离散帧采样，不能据此声称完整观看了整个时间段。历史观察图片是当次固定快照，不会随之后的编辑更新。`,
  parameters: viewTimelineParameters(),
}
