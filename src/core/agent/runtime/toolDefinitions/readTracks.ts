import type { ModelTool } from '../../transport/AgentClient'

export const readTracksDefinition: ModelTool = {
  name: 'read_tracks',
  description: `What It Does
-------------
批量读取一个或多个轨道上的时间轴 clip 列表。

Use When
---------
- 需要定位 clip ID、mediaId、轨道归属或时间范围
- 需要查看某个时间点或时间段内有哪些 clip

Filter Semantics
---------------
- start 和 end 使用 HH:MM:SS+FF 时间码
- clip 按时间范围相交筛选

Returns
--------
{
  "tool": "read_tracks",
  "tracks": [
    {
      "trackId": "<trackId>",
      "items": [
        {
          "itemId": "<clipId>",
          "itemType": "clip",
          "mediaId": "<mediaId>",
          "mediaType": "video|audio|image",
          "start": "HH:MM:SS+FF",
          "end": "HH:MM:SS+FF"
        }
      ],
      "total": 1
    }
  ],
  "requestedTotal": 1,
  "total": 1,
  "failedTotal": 0
}

Limitations
-----------
trackIds 必须来自 list_tracks 或用户明确提供的有效轨道 ID。`,
  parameters: {
    type: 'object',
    properties: {
      trackIds: {
        type: 'array',
        items: { type: 'string' },
        minItems: 1,
        maxItems: 10,
        description: '要读取的轨道 ID 数组。重复 ID 会自动去重。',
      },
      start: {
        type: 'string',
        description: '可选筛选起始时间，格式为 HH:MM:SS+FF。',
      },
      end: {
        type: 'string',
        description: '可选筛选结束时间，格式为 HH:MM:SS+FF。',
      },
    },
    required: ['trackIds'],
    additionalProperties: false,
  },
}
