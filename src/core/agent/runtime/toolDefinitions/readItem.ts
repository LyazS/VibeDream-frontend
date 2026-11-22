import type { ModelTool } from '../../transport/AgentClient'

export const readItemDefinition: ModelTool = {
  name: 'read_item',
  description: `What It Does
-------------
读取一个时间轴 clip 的结构化属性。

Use When
---------
- 修改 clip 前，需要读取当前值作为 update_item 的 match 条件
- 准备修改 clip 静态属性，需要读取 visual、audio 或 timeline 属性组
- 需要在当前播放头或指定时间点读取受关键帧动画影响后的 clip 实际属性值
- 需要确认 clip 所在轨道、时间范围或源区间，再进行 move_clip、trim_clip 或 split_clip

Do Not Use When
---------------
- 需要先在轨道中定位 clip 时，应使用 read_tracks
- 需要读取关键帧动画时，应使用 read_clip_keyframe
- 需要读取素材库素材详情时，应使用 read_media

Returns
--------
{
  "tool": "read_item",
  "itemId": "<clipId>",
  "itemType": "clip",
  "mediaType": "<mediaType>",
  "sampleTime": "<timecode>",
  "groups": {
    "visual": { "...": "..." },
    "audio": { "...": "..." },
    "timeline": { "...": "..." }
  }
}

Limitations
-----------
clip 支持 visual、audio、timeline。读取多个 group 时，只要任一 group 无效或不受支持则整次失败。未传 sampleTime 时，clip 默认使用当前播放头时间。`,
  parameters: {
    type: 'object',
    properties: {
      itemId: {
        type: 'string',
        description: '要读取的时间轴 clip ID。',
      },
      propertyGroups: {
        type: 'array',
        items: {
          type: 'string',
          enum: ['visual', 'audio', 'timeline'],
        },
        minItems: 1,
        description: '要读取的属性组。',
      },
      sampleTime: {
        type: 'string',
        description: '可选采样时间，格式为 HH:MM:SS+FF。',
      },
    },
    required: ['itemId', 'propertyGroups'],
    additionalProperties: false,
  },
}
