import type { ModelTool } from '../../transport/AgentClient'

export const insertClipDefinition: ModelTool = {
  name: 'insert_clip',
  description: `What It Does
-------------
将素材库中的素材插入到指定轨道的指定时间点；也可选择素材源区间，只插入素材其中一段。

Use When
---------
- 需要把现有 video/image/audio 素材放到时间轴

Do NOT Use When
---------------
- 需要创建文字/字幕 clip 时，应使用 create_subtitle_clip
- 需要移动已有片段时，应使用 move_clip

Examples
--------
把一个视频素材从素材开头插入到视频轨道的第 10 秒：
{
  "mediaId": "video_001.mp4",
  "trackId": "track_video_1",
  "start": "00:00:10+00"
  // 如果只插入素材的第 3 秒到第 8 秒片段，则需要额外提供以下两个字段：
  "clipStart": "00:00:03+00",
  "clipEnd": "00:00:08+00"
}

Returns
--------
{
  "tool": "insert_clip",                  // 工具名
  "clipId": "<clipId>",                   // 新时间轴片段 ID
  "mediaId": "<mediaId>",                 // 被插入的素材 ID
  "trackId": "<trackId>",                 // 目标轨道 ID
  "start": "<start>",                     // 时间轴起始时间码
  "end": "<end>",                         // 时间轴结束时间码
  "warning": "<warning>",                 // 警告信息
  "overlapClipIds": ["<clipId>"]          // 与本次插入重叠的片段 ID 列表
}

{
  "tool": "insert_clip",                  // 工具名
  "error": "<errorMessage>"               // 错误说明；根据提示调整参数，或先读取素材/轨道状态
}

Limitations
-----------
insert_clip 只负责把素材放到指定位置，不会自动调整同轨已有片段的位置或时长。
video 轨道可放 video/image；audio 轨道只能放 audio。`,
  parameters: {
    type: 'object',
    properties: {
      mediaId: {
        type: 'string',
        description:
          '要插入的素材 ID。必须来自 list_media/search_media/read_media 返回的完整 mediaId，不要传 clipId。',
      },
      trackId: {
        type: 'string',
        description:
          '目标轨道 ID。如果还没有 trackId，应先通过 list_tracks 选择。必须使用 list_tracks 返回的 trackId，并与素材类型兼容。',
      },
      start: {
        type: 'string',
        description: '插入到时间轴的开始时间，格式 HH:MM:SS+FF。来自用户指定或根据当前时间轴计算。',
      },
      clipStart: {
        type: 'string',
        description: '可选素材源区间开始时间，格式 HH:MM:SS+FF。不提供时会从素材开头开始。',
      },
      clipEnd: {
        type: 'string',
        description:
          '可选素材源区间结束时间，格式 HH:MM:SS+FF。用于只插入素材的一段。不提供时会使用素材末尾。',
      },
    },
    required: ['mediaId', 'trackId', 'start'],
  },
}
