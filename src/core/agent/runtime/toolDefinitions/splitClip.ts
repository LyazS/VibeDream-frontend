import type { ModelTool } from '../../transport/AgentClient'

export const splitClipDefinition: ModelTool = {
  name: 'split_clip',
  description: `What It Does
-------------
在一个已有时间轴片段内部按一个或多个时间点切分。

Use When
---------
- 需要把某个 clip 切开、分割或在指定时间点剪一刀
- 已通过 read_item 的 timeline group 确认 clipId 和片段时间范围

Do NOT Use When
---------------
- 需要裁掉片段开头或结尾时，应使用 trim_clip
- 分割点不在片段内部，或等于开始/结束边界

Examples
--------
在时间轴绝对时间 00:00:10+00 和 00:00:20+00 处切分一个 clip：
{
  "clipId": "clip_123",
  "splitTimes": ["00:00:10+00", "00:00:20+00"]
}

Returns
--------
{
  "tool": "split_clip",                   // 工具名
  "originalClipId": "<clipId>",           // 被切分的原始片段 ID
  "splitTimes": ["<timecode>"],           // 实际执行的切分时间点
  "newClips": [
    {
      "clipId": "<clipId>",               // 新片段 ID
      "start": "<timecode>",              // 新片段在时间轴上的开始时间
      "end": "<timecode>"                 // 新片段在时间轴上的结束时间
    }
  ],
  "summary": "<summary>"                  // 结果摘要
}

{
  "tool": "split_clip",                   // 工具名
  "error": "<errorMessage>"               // 错误说明
}

Limitations
-----------
splitTimes 会去重并按时间升序处理。分割点必须位于片段内部。`,
  parameters: {
    type: 'object',
    properties: {
      clipId: {
        type: 'string',
        description:
          '要切分的时间轴片段 ID。如果还没有 clipId，应先通过 read_tracks/read_item 定位。必须使用 read_tracks/read_item 返回的 clipId。',
      },
      splitTimes: {
        type: 'array',
        description:
          '分割时间点数组，格式 HH:MM:SS+FF，表示时间轴上的绝对时间。不是相对这个 clip 起点的偏移时间。每个时间点都必须位于该 clip 的时间轴范围内部，不能等于片段开始或结束边界。',
        items: {
          type: 'string',
          description: '一个时间轴绝对分割点，格式 HH:MM:SS+FF。',
        },
        minItems: 1,
      },
    },
    required: ['clipId', 'splitTimes'],
  },
}
