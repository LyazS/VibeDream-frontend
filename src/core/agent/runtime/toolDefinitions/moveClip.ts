import type { ModelTool } from '../../transport/AgentClient'

export const moveClipDefinition: ModelTool = {
  name: 'move_clip',
  description: `What It Does
-------------
移动已有时间轴片段到新的开始时间，也可同时移动到另一条兼容轨道。

Use When
---------
- 需要移动、对齐或换轨某个已有 clip

Do NOT Use When
---------------
- 需要插入新素材时，应使用 insert_clip
- 需要调整片段边界/时长时，应使用 trim_clip

Returns
--------
{
  "tool": "move_clip",                    // 工具名
  "clipId": "<clipId>",                   // 被移动的片段 ID
  "before": {                             // 移动前状态；仅包含本次发生变化的字段
    "trackId": "<trackId>",               // 可选；轨道 ID
    "start": "<start>"                    // 可选；开始时间
  },
  "after": {                              // 移动后状态；
    "trackId": "<trackId>",
    "start": "<start>"
  },
  "warning": "<warning>",                 // 可选；警告信息
  "overlapClipIds": ["<clipId>"]          // 可选；当发生同轨重叠时出现，表示与本次移动重叠的片段 ID 列表
}

{
  "tool": "move_clip",                    // 工具名
  "error": "<errorMessage>"               // 错误说明
}

Limitations
-----------
只修改 clip 在 timeline 位置与轨道归属，不修改素材源区间。
只能移动到与该 clip 媒体类型兼容的轨道。
如果实际当前 start 或 trackId 与传入的 from 值不一致，不会执行移动并会返回错误。`,
  parameters: {
    type: 'object',
    properties: {
      clipId: {
        type: 'string',
        description:
          '要移动的时间轴片段 ID。必须来自 read_tracks/read_item 返回的 clipId，不要传 mediaId。',
      },
      start: {
        type: 'object',
        description: '时间轴开始时间的变更。from/to 都必填，格式 HH:MM:SS+FF。',
        properties: {
          from: {
            type: 'string',
            description: '移动前的时间轴开始时间，格式 HH:MM:SS+FF。',
          },
          to: {
            type: 'string',
            description: '移动后的时间轴开始时间。',
          },
        },
        required: ['from', 'to'],
        additionalProperties: false,
      },
      trackId: {
        type: 'object',
        description: '可选轨道变更。不提供时表示保持原轨道；提供时 from/to 都必填。',
        properties: {
          from: {
            type: 'string',
            description: '移动前的轨道 ID。',
          },
          to: {
            type: 'string',
            description: '移动后的轨道 ID。',
          },
        },
        required: ['from', 'to'],
        additionalProperties: false,
      },
    },
    required: ['clipId', 'start'],
    additionalProperties: false,
  },
}
