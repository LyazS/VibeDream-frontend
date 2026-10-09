import type { ModelTool } from '../../transport/AgentClient'

export const moveTrackDefinition: ModelTool = {
  name: 'move_track',
  description: `What It Does
-------------
调整一条轨道在时间轴轨道列表中的顺序。

Use When
---------
- 需要上移、下移或移动某条轨道到指定层级
- 需要改变视觉层级，且已通过 list_tracks 确认当前 index

Do NOT Use When
---------------
- 需要移动的是 clip 时，应使用 move_clip
- 只是要修改轨道名称、显隐或静音属性，应使用 update_track_properties

Returns
--------
{
  "tool": "move_track",                   // 工具名
  "trackId": "<trackId>",                 // 被移动的轨道 ID
  "before": {                             // 移动前状态
    "index": "<trackIndex>"               // 0-based 轨道索引
  },
  "after": {                              // 移动后状态
    "index": "<trackIndex>"
  }
}

{
  "tool": "move_track",                   // 工具名
  "error": "<errorMessage>"               // 错误说明
}

Limitations
-----------
只修改轨道顺序，不移动轨道内片段的时间位置。轨道 index 越小视觉层级越高。
index.from 用于校验轨道当前顺序；若轨道实际 index 与 index.from 不一致，不会执行移动并失败。`,
  parameters: {
    type: 'object',
    properties: {
      trackId: {
        type: 'string',
        description: '要移动的轨道 ID。必须来自 list_tracks 返回的 trackId。',
      },
      index: {
        type: 'object',
        description: '轨道顺序的变更。from/to 都必填，均为 0-based 轨道索引。',
        properties: {
          from: {
            type: 'integer',
            description: '移动前的轨道索引，0-based。必须来自 list_tracks 返回的 index。',
            minimum: 0,
          },
          to: {
            type: 'integer',
            description:
              '移动后的目标轨道索引，0-based。根据 list_tracks 返回的 index 或用户指定层级计算；越小越靠上。',
            minimum: 0,
          },
        },
        required: ['from', 'to'],
        additionalProperties: false,
      },
    },
    required: ['trackId', 'index'],
    additionalProperties: false,
  },
}
