import type { ModelTool } from '../../transport/AgentClient'

export const writeClipKeyframeDefinition: ModelTool = {
  name: 'write_clip_keyframe',
  description: `What It Does
-------------
整体替换一个 clip 某个关键帧属性的完整关键帧数组。

Use When
---------
- 需要生成一段新的动画，例如位置移动、淡入淡出、旋转或缩放
- 需要重写整条关键帧曲线
- 已先通过 describe_item_property(propertyIds=["visual.position.x"], usage='keyframe_edit') 解析出正确的 propertyId
- 已先调用 read_clip_keyframe 了解当前状态和 value shape

Do NOT Use When
---------------
- 只要修改局部连续关键帧，应使用 patch_clip_keyframe
- 只要修改静态属性，应使用 update_item
- 不知道 clipId、propertyId 或 value shape

Returns
--------
{
  "tool": "write_clip_keyframe",          // 工具名
  "clipId": "<clipId>",                   // 被修改的片段 ID
  "propertyId": "<propertyId>",           // 被写入的可动画属性 ID
  "status": "applied"                     // 写入结果
}

{
  "tool": "write_clip_keyframe",          // 工具名
  "error": "<errorMessage>"               // 错误说明
}

Limitations
-----------
keyframes 表示写入后的完整目标状态，默认 entire-channel 整体替换旧关键帧。time 使用时间轴绝对时间码 HH:MM:SS+FF。工具会排序、去重、校验 value shape 并归一化。`,
  parameters: {
    type: 'object',
    properties: {
      clipId: {
        type: 'string',
        description:
          '时间轴片段 ID，也就是 clipId。必须来自 read_tracks/read_item/read_clip_keyframe 返回结果。',
      },
      propertyId: {
        type: 'string',
        description:
          '关键帧场景下的属性 ID。必须与用户要修改的动画属性一致；不能传 visual.position.x 这类静态字段，应先用 describe_item_property(propertyIds=["visual.position.x"], usage=\'keyframe_edit\') 解析，再用 read_clip_keyframe 确认当前属性和值形态。',
      },
      keyframes: {
        type: 'array',
        description:
          '写入后的完整目标关键帧数组。不是增量；会作为该属性的完整状态整体替换。time 使用时间轴绝对时间码 HH:MM:SS+FF。',
        items: {
          type: 'object',
          properties: {
            time: {
              type: 'string',
              description: '时间轴绝对时间码，格式 HH:MM:SS+FF。',
            },
            value: {
              description:
                '关键帧值。必须直接使用 read_clip_keyframe 返回的 value 形态填写，不要自行改成其他包装结构。',
            },
            easing: {
              type: 'object',
              description: '可选 easing；当前仅支持 linear',
              properties: {
                type: {
                  type: 'string',
                  description: '当前仅支持 linear',
                },
              },
              required: ['type'],
            },
          },
          required: ['time', 'value'],
        },
      },
      options: {
        type: 'object',
        description:
          '可选写入选项。不确定时可省略，让工具使用默认 absolute frameMode 与 entire-channel replaceMode。',
        properties: {
          frameMode: {
            type: 'string',
            description: '帧模式，第一版仅支持 absolute',
          },
          replaceMode: {
            type: 'string',
            description: '替换模式，第一版仅支持 entire-channel',
          },
          atomic: {
            type: 'boolean',
            description: '是否按原子语义整体写入',
          },
          normalizeBeforeApply: {
            type: 'boolean',
            description: '写入前是否自动排序、去重、归一化',
          },
        },
      },
    },
    required: ['clipId', 'propertyId', 'keyframes'],
  },
}
