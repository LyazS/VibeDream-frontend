import type { ModelTool } from '../../transport/AgentClient'

export const createSubtitleClipDefinition: ModelTool = {
  name: 'create_subtitle_clip',
  description: `What It Does
-------------
在 text 轨道上创建一个字幕/文字类型时间轴片段。

Use When
---------
- 需要新增字幕、标题、文字卡或文本片段等

Do NOT Use When
---------------
- 需要插入素材库中的 video/image/audio，应使用 insert_clip
- 目标轨道不是 text 类型，应先通过 list_tracks 选择或创建新的 text 轨道

Returns
--------
{
  "tool": "create_subtitle_clip",         // 工具名
  "clipId": "<clipId>",                   // 新字幕片段 ID，可用于 read_item、trim_clip 等工具
  "trackId": "<trackId>",                 // 字幕所在的 text 轨道 ID
  "text": "<text>",                       // 实际创建出的字幕内容
  "start": "<start>",                     // 时间轴起始时间码
  "end": "<end>",                         // 时间轴结束时间码
  "warning": "<warning>",                 // 警告信息
  "overlapClipIds": ["<clipId>"]          // 与本次字幕重叠的片段 ID 列表
}

{
  "tool": "create_subtitle_clip",         // 工具名
  "error": "<errorMessage>"               // 错误说明；根据提示调整参数、先检查轨道类型或轨道占用情况
}

Limitations
-----------
只在 text 轨道创建字幕片段。若目标区间与同轨现有片段重叠，不会自动避让或调整已有片段位置。`,
  parameters: {
    type: 'object',
    properties: {
      text: {
        type: 'string',
        description: '字幕/文字内容。必须来自用户提供或根据用户请求生成。',
      },
      trackId: {
        type: 'string',
        description:
          '目标 text 轨道 ID。如果还没有合适的 text 轨道，应先通过 list_tracks 选择，必要时再创建新的 text 轨道。必须使用 text 类型的 trackId。',
      },
      start: {
        type: 'string',
        description:
          '字幕在时间轴上的开始时间，格式 HH:MM:SS+FF。来自用户指定或根据当前编辑上下文推导；需要检查该时间段是否已有片段时，可先用 read_tracks 查看。',
      },
      duration: {
        type: 'string',
        description: '字幕显示时长，格式 HH:MM:SS+FF。不是结束时间；应根据用户要求或目标节奏填写。',
      },
    },
    required: ['text', 'trackId', 'start', 'duration'],
  },
}
