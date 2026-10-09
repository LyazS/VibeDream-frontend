import type { ModelTool } from '../../transport/AgentClient'

export const patchClipKeyframeDefinition: ModelTool = {
  name: 'patch_clip_keyframe',
  description: `What It Does
-------------
局部替换一个连续关键帧片段。

Use When
---------
- 需要局部精修已有动画
- 只需要替换某个连续关键帧片段，保留其他关键帧
- 已先通过 describe_item_property(propertyIds=["visual.position.x"], usage='keyframe_edit') 解析出正确的 propertyId

Do NOT Use When
---------------
- 需要重写整条动画曲线，应使用 write_clip_keyframe
- 只要修改静态属性，应使用 update_item
- 未读取当前关键帧，无法准确填写 match

Examples
--------
当前关键帧状态（来自 read_clip_keyframe）：
{
  "clipId": "clip_123",
  "propertyId": "visual.rotation",
  "keyframes": [
    { "time": "00:00:00+00", "value": 0 },
    { "time": "00:00:01+00", "value": 15 },
    { "time": "00:00:02+00", "value": 30 },
    { "time": "00:00:03+00", "value": 45 }
  ]
}

如果需要在首帧前插入一帧：
{
  "clipId": "clip_123",
  "propertyId": "visual.rotation",
  "match": [
    { "time": "00:00:01+00", "value": 15 }
  ],
  "apply": [
    { "time": "00:00:00+10", "value": 8 },
    { "time": "00:00:01+00", "value": 15 }
  ]
}

如果需要在中间插入一帧：
{
  "clipId": "clip_123",
  "propertyId": "visual.rotation",
  "match": [
    { "time": "00:00:01+00", "value": 15 },
    { "time": "00:00:02+00", "value": 30 }
  ],
  "apply": [
    { "time": "00:00:01+00", "value": 15 },
    { "time": "00:00:01+15", "value": 22 },
    { "time": "00:00:02+00", "value": 30 }
  ]
}

如果需要在尾帧后插入一帧：
{
  "clipId": "clip_123",
  "propertyId": "visual.rotation",
  "match": [
    { "time": "00:00:02+00", "value": 30 }
  ],
  "apply": [
    { "time": "00:00:02+00", "value": 30 },
    { "time": "00:00:03+20", "value": 60 }
  ]
}

如果需要修改某一帧：
{
  "clipId": "clip_123",
  "propertyId": "visual.rotation",
  "match": [
    { "time": "00:00:02+00", "value": 30 }
  ],
  "apply": [
    { "time": "00:00:02+00", "value": 28 }
  ]
}

如果需要删除中间连续的一段关键帧（例如 00:00:01+00 和 00:00:02+00）：
{
  "clipId": "clip_123",
  "propertyId": "visual.rotation",
  "match": [
    { "time": "00:00:01+00", "value": 15 },
    { "time": "00:00:02+00", "value": 30 }
  ],
  "apply": []
}

Returns
--------
{
  "tool": "patch_clip_keyframe",          // 工具名
  "clipId": "<clipId>",                   // 被修改的片段 ID
  "propertyId": "<propertyId>",           // 被修改的可动画属性 ID
  "before": [                             // 修改前关键帧；与本次 patch 无关的片段用 ... 省略
    ...,
    { "time": "<timecode>", "value": "<value>" },
    { "time": "<timecode>", "value": "<value>" },
    ...
  ],
  "after": [                              // 修改后关键帧
    ...,
    { "time": "<timecode>", "value": "<value>" },
    { "time": "<timecode>", "value": "<value>" },
    ...
  ]
}

{
  "tool": "patch_clip_keyframe",          // 工具名
  "error": "<errorMessage>"               // 错误说明
}

Limitations
-----------
只支持一个连续关键帧片段 patch，不支持多片段混合补丁。
match 必须非空，其首尾时间共同定义本次替换片段。只有当前该片段内的关键帧与 match 完全匹配时，才会应用 apply。`,
  parameters: {
    type: 'object',
    properties: {
      clipId: {
        type: 'string',
        description: '时间轴片段 ID，也就是 clipId。',
      },
      propertyId: {
        type: 'string',
        description:
          '关键帧场景下的属性 ID。必须与用户要修改的动画属性一致；不能传 visual.position.x 这类静态字段，应先用 describe_item_property(propertyIds=["visual.position.x"], usage=\'keyframe_edit\') 解析，再用 read_clip_keyframe 确认当前属性和值形态。',
      },
      match: {
        type: 'array',
        description:
          '要匹配的旧关键帧片段。必须来自最近一次 read_clip_keyframe 的当前结果；不要凭空编造。',
        items: {
          type: 'object',
          properties: {
            time: {
              type: 'string',
              description: '时间轴绝对时间码，格式 HH:MM:SS+FF。',
            },
            value: {
              description:
                '旧关键帧值。必须直接使用最近一次 read_clip_keyframe 返回的 value，不要自行改写结构。',
            },
          },
          required: ['time', 'value'],
        },
        minItems: 1,
      },
      apply: {
        type: 'array',
        description:
          '替换后的新关键帧片段。会整体替换 match 所定义片段内的旧内容；片段外关键帧保持不变。',
        items: {
          type: 'object',
          properties: {
            time: {
              type: 'string',
              description: '时间轴绝对时间码，格式 HH:MM:SS+FF。',
            },
            value: {
              description:
                '新关键帧值。结构必须与当前属性的 read_clip_keyframe 返回 value 形态一致。',
            },
          },
          required: ['time', 'value'],
        },
      },
    },
    required: ['clipId', 'propertyId', 'match', 'apply'],
  },
}
