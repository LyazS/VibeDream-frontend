import type { ModelTool } from '../../transport/AgentClient'

export const updateItemDefinition: ModelTool = {
  name: 'update_item',
  description: `What It Does
-------------
按 match 条件更新一个时间轴 item。clip 保持静态属性编辑能力；转场只允许修改配置时长和模板参数。

Use When
---------
- 需要修改 clip 的位置、尺寸、旋转、透明度、音量、静音、文本或文本样式等静态属性
- 已通过 read_item 读取目标 item 的当前属性值，准备将其作为 match 条件
- 已通过 describe_item_property(propertyIds=["visual.position.x"], usage="static_edit") 确认 clip 静态属性的 propertyId、值类型和限制
- 已读取转场的 transition group，准备修改 transition.duration 或 transition.params.<parameterKey>
- 已通过 describe_item_property 确认转场参数类型、范围和选项
- 只需要修改少量静态属性，而不是时间轴位置、素材源区间或关键帧动画

Do NOT Use When
---------------
- 需要替换转场模板时，应使用 apply_transition
- 需要改变左右 clip、轨道或拼接点时；这些不是可编辑属性
- 目标 clip 属性已被关键帧控制时，应使用关键帧工具
- 没有 read_item 返回的当前属性值可作为 match 时

Examples
--------
clip 静态属性：
{
  "itemId": "clip_123",
  "match": { "visual.opacity": 1 },
  "apply": { "visual.opacity": 0.6 }
}

clip 文本内容：
{
  "itemId": "clip_text_1",
  "match": { "text.content": "旧字幕" },
  "apply": { "text.content": "新字幕" }
}

转场配置时长：
{
  "itemId": "transition:<leftClipId>:<templateId>",
  "match": { "transition.duration": "00:00:00+15" },
  "apply": { "transition.duration": "00:00:01+00" }
}

转场模板参数：
{
  "itemId": "transition:<leftClipId>:<templateId>",
  "match": { "transition.params.adjust": 0.5 },
  "apply": { "transition.params.adjust": 0.8 }
}

Returns
--------
{
  "tool": "update_item",                 // 工具名
  "itemId": "<itemId>",                  // 被更新的 clip 或 transition item ID
  "itemType": "clip|transition",         // item 类型
  "before": { ... },                       // apply 中每个属性在写入前的值
  "after": { ... }                         // 成功写入后的属性值
}

{
  "tool": "update_item",                 // 工具名
  "error": "<errorMessage>"               // match 失败、参数无效或转场范围重叠的说明
}

Limitations
-----------
match 和 apply 必须使用相同的属性路径，且 match 的值必须与 read_item 返回的当前值一致。

clip 仅支持静态 propertyId；应先用 describe_item_property 的 static_edit 用途确认属性。若属性已受关键帧控制，工具会拒绝写入，应改用 write_clip_keyframe 或 patch_clip_keyframe。

转场 itemId 必须使用 read_tracks 或 apply_transition 返回的完整 ID。转场仅支持 transition.duration（HH:MM:SS+FF）和 transition.params.<parameterKey>；应先以 transition_edit 用途描述参数 schema。工具会校验参数 schema 及转场有效范围，不允许创建与共享 clip 上其他转场重叠的配置。`,
  parameters: {
    type: 'object',
    properties: {
      itemId: {
        type: 'string',
        description:
          '要修改的时间轴 clip ID，或 read_tracks/apply_transition 返回的完整 transition item ID。',
      },
      match: {
        type: 'object',
        description:
          '当前属性匹配条件。键必须是将要写入的完整属性路径，值必须来自 read_item 的预期旧值，用于防止覆盖用户或编辑环境刚刚产生的变化。clip 应先通过 describe_item_property(propertyIds=["visual.position.x"], usage="static_edit") 确认静态 propertyId；转场仅支持 transition.duration 或 transition.params.<parameterKey>。',
      },
      apply: {
        type: 'object',
        description:
          '属性修改内容。键必须与 match 使用完全相同的属性路径，值为新值。clip 仅支持未被关键帧控制的静态 propertyId；转场 duration 必须为 HH:MM:SS+FF，参数值必须符合 describe_item_property(..., usage="transition_edit") 返回的 schema。',
      },
    },
    required: ['itemId', 'match', 'apply'],
    additionalProperties: false,
  },
}
