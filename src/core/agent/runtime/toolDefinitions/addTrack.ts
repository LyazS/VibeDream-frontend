import type { ModelTool } from '../../transport/AgentClient'

export const addTrackDefinition: ModelTool = {
  name: 'add_track',
  description: `What It Does
-------------
在时间轴中新增一条指定类型的轨道。

Use When
---------
- 需要新增轨道
- 插入素材或字幕前发现没有合适类型的目标轨道，且用户意图允许创建

Do NOT Use When
---------------
- 已有合适轨道，应直接使用现有 trackId
- 需要先查看轨道结构或轨道顺序时，应使用 list_tracks

Returns
--------
{
  "tool": "add_track",                    // 工具名
  "trackId": "<trackId>",                 // 新轨道 ID
  "index": "<trackIndex>"                 // 新轨道在时间轴中的 0-based 索引
}

{
  "tool": "add_track",                    // 工具名
  "error": "<errorMessage>"               // 错误说明；
}`,
  parameters: {
    type: 'object',
    properties: {
      trackType: {
        type: 'string',
        enum: ['video', 'audio', 'text'],
        description:
          '要新增的轨道类型。video 用于 video/image 素材；audio 用于音频；text 用于字幕/文字。',
      },
      position: {
        type: 'integer',
        description:
          '可选插入位置，0-based 轨道索引。来自用户指定或根据 list_tracks 返回的轨道顺序推导；不提供时追加到末尾。',
        minimum: 0,
      },
    },
    required: ['trackType'],
  },
}
