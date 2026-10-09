import type { ModelTool } from '../../transport/AgentClient'

export const trimClipDefinition: ModelTool = {
  name: 'trim_clip',
  description: `What It Does
-------------
调整已有时间轴片段的一侧边界，用于 trim 或 extend。

Use When
---------
- 需要裁掉/延长某个 clip 的开头或结尾

Do NOT Use When
---------------
- 需要移动整个 clip 时，应使用 move_clip
- 需要在中间切开时，应使用 split_clip
- 需要修改画面位置、透明度、文本等静态属性时，应使用 update_item

Examples
--------
把片段开始边界从当前时间向后裁到 00:00:12+00：
{
  "clipId": "clip_123",
  "side": "start",
  "newValue": "00:00:12+00"
}

把片段结束边界延长到 00:00:25+00：
{
  "clipId": "clip_123",
  "side": "end",
  "newValue": "00:00:25+00"
}

Returns
--------
{
  "tool": "trim_clip",                    // 工具名
  "clipId": "<clipId>",                   // 被裁切的片段 ID
  "before": {                             // 裁切前状态
    "start": "<timecode>",                // 片段在时间轴上的开始时间
    "end": "<timecode>",                  // 片段在时间轴上的结束时间
    "clipStart": "<timecode>",            // video/audio 的素材起始时间
    "clipEnd": "<timecode>"               // video/audio 的素材结束时间
  },
  "after": {                              // 裁切后状态
    "start": "<timecode>",
    "end": "<timecode>",
    "clipStart": "<timecode>",
    "clipEnd": "<timecode>"
  },
  "warning": "<warning>",                 // 可选；警告信息
  "overlapClipIds": ["<clipId>"],         // 可选；与本次裁切结果发生同轨重叠的片段 ID 列表
  "summary": "<summary>"                  // 可选摘要
}

{
  "tool": "trim_clip",                    // 工具名
  "error": "<errorMessage>"               // 错误说明
}

Limitations
-----------
一次只调整一侧边界。
newValue 是由 side 指定的时间轴边界新值，不是素材 source 时间。
video/audio 保持当前播放倍速并同步 source 区间；
image/text 只调整 timeline 边界。
超出素材可用范围或时间轴合法边界会报错。`,
  parameters: {
    type: 'object',
    properties: {
      clipId: {
        type: 'string',
        description: '要调整边界的时间轴片段 ID。必须来自 read_tracks/read_item 返回的 clipId。',
      },
      side: {
        type: 'string',
        enum: ['start', 'end'],
        description: '要调整哪一侧边界。start=片段开始边界，end=片段结束边界。',
      },
      newValue: {
        type: 'string',
        description: '由 side 指定的时间轴边界新值，格式 HH:MM:SS+FF。不是素材 source 内部时间。',
      },
    },
    required: ['clipId', 'side', 'newValue'],
  },
}
