import type { ModelTool } from '../../transport/AgentClient'

export const removeTrackDefinition: ModelTool = {
  name: 'remove_track',
  description: `What It Does
-------------
删除一条时间轴轨道。

Use When
---------
- 需要删除某条轨道
- 确认目标 trackId 和影响范围

Do NOT Use When
---------------
- 只需要修改轨道名称、显隐或静音属性时，应使用 update_track_properties

Returns
--------
{
  "tool": "remove_track",                 // 工具名
  "trackId": "<trackId>",                 // 被删除的轨道 ID
  "summary": "<summary>"                  // 结果摘要
}

{
  "tool": "remove_track",                 // 工具名
  "error": "<errorMessage>"               // 错误说明
}

Limitations
-----------
删除轨道会同时删除该轨道上的所有片段。不允许删除最后一个轨道。`,
  parameters: {
    type: 'object',
    properties: {
      trackId: {
        type: 'string',
        description:
          '要删除的轨道 ID。如果还没有 trackId，应先通过 list_tracks 获取，并在需要时用 read_tracks 确认该轨道上的片段。必须使用 list_tracks 返回的 trackId，或用户明确提供的有效 trackId。',
      },
    },
    required: ['trackId'],
  },
}
