import type { ModelTool } from '../../transport/AgentClient'

export const listTracksDefinition: ModelTool = {
  name: 'list_tracks',
  description: `What It Does
-------------
获取当前时间轴所有轨道的概览信息。

Use When
---------
- 需要查看时间轴结构或当前有哪些轨道
- 需要选择 video/audio/text 目标轨道

Do NOT Use When
---------------
- 需要读取一个或多个轨道上的片段时，应使用 read_tracks
- 需要读取某个 clip 详情，应使用 read_item
- 需要浏览素材库，应使用 list_media

Returns
--------
{
  "tool": "list_tracks",                  // 工具名
  "tracks": [
    {
      "trackId": "<trackId>",             // 轨道 ID
      "name": "<trackName>",              // 轨道名称
      "type": "<trackType>",              // 轨道类型
      "index": "<trackIndex>",            // 轨道在时间轴中的 0-based 顺序
      "visible": "<visible>",             // 轨道是否可见
      "muted": "<muted>",                 // 轨道是否静音
      "clipCount": "<clipCount>"          // 当前轨道上的片段数量
    }
  ],
  "total": "<total>"                      // 当前时间轴轨道总数
}

{
  "tool": "list_tracks",                  // 工具名
  "error": "<errorMessage>"               // 错误说明
}

Limitations
-----------
只返回轨道概览，不返回每条轨道上的完整 clip 列表；
需要片段列表时继续调用 read_tracks。`,
  parameters: {
    type: 'object',
    properties: {},
    required: [],
    additionalProperties: false,
  },
}
