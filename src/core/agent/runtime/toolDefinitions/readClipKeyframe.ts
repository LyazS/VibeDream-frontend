import type { ModelTool } from '../../transport/AgentClient'

export const readClipKeyframeDefinition: ModelTool = {
  name: 'read_clip_keyframe',
  description: `What It Does
-------------
在写入或修改关键帧前，先读取指定片段某个关键帧属性的当前状态。

Use When
---------
- 准备为 clip 写入、重写或局部修改关键帧动画
- 已先通过 describe_item_property(propertyIds=["visual.position.x"], usage='keyframe_edit') 解析出正确的 propertyId
- 需要先查看当前关键帧状态

Do NOT Use When
---------------
- 用户只要修改静态属性，应使用 update_item
- 需要先在轨道中定位目标片段时，应使用 read_tracks
- 用户只是查看素材详情，应使用 read_media

Returns
--------
{
  "tool": "read_clip_keyframe",
  "clipId": "<clipId>",                  // 时间轴片段 ID
  "mediaType": "<mediaType>",            // 片段类型
  "propertyId": "<propertyId>",          // 本次读取的可动画属性 ID
  "timelineRange": {                     // 该片段在时间轴上的时间范围
    "start": "<timecode>",
    "end": "<timecode>",
    "duration": "<timecode>"
  },
  "keyframes": [                         // 当前关键帧列表，按 time 升序
    {
      "time": "<timecode>",              // 时间轴绝对时间
      "relativeTime": "<timecode>",      // 相对片段起点的时间
      "position": "<position>",          // 在片段时长中的归一化位置
      "value": "<value>",                // 关键帧值；其具体结构应以 describe_item_property 和当前读取结果为准
      "easing": { "type": "linear" }     // 当前仅支持 linear
    }
  ]
}

{
  "tool": "read_clip_keyframe",
  "error": "<errorMessage>"
}

Limitations
-----------
一次读取单个 propertyId。关键帧场景下的 propertyId 必须是可动画属性；静态字段不能直接用于关键帧工具。describe_item_property 已升级为批量接口，即使只查询一个属性，也应传单元素 \`propertyIds\` 数组。`,
  parameters: {
    type: 'object',
    properties: {
      clipId: {
        type: 'string',
        description:
          '时间轴片段 ID，也就是 clipId。如果还没有 clipId，应先通过 read_tracks 或 read_item 定位。必须使用 read_tracks/read_item 返回的 clipId。',
      },
      propertyId: {
        type: 'string',
        description:
          '关键帧场景下的属性 ID。必须与用户要动画化的属性一致；不能传 visual.position.x 这类静态字段，应先通过 describe_item_property(propertyIds=["visual.position.x"], usage=\'keyframe_edit\') 解析。',
      },
    },
    required: ['clipId', 'propertyId'],
  },
}
