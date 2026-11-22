import type { ModelTool } from '../../transport/AgentClient'

export const updateItemDefinition: ModelTool = {
  name: 'update_item',
  description: `What It Does
-------------
按 match 条件更新一个时间轴 clip 的静态属性。

Use When
---------
- 需要修改 clip 的位置、尺寸、旋转、透明度、混合模式、音量、静音等静态属性
- 已通过 read_item 读取目标 clip 的当前属性值，准备将其作为 match 条件
- 已通过 describe_item_property 确认静态 propertyId、值类型和限制

Do Not Use When
---------------
- 需要改变 clip 的时间轴位置、轨道或素材源区间时，应使用对应的时间轴编辑工具
- 目标属性已被关键帧控制时，应使用关键帧工具
- 没有 read_item 返回的当前属性值可作为 match 时

Examples
--------
{
  "itemId": "clip_123",
  "match": { "visual.position.x": 0 },
  "apply": { "visual.position.x": 120 }
}

Returns
--------
{
  "tool": "update_item",
  "itemId": "<itemId>",
  "itemType": "clip",
  "before": { "...": "..." },
  "after": { "...": "..." }
}

Limitations
-----------
match 和 apply 必须使用相同的属性路径，且 match 的值必须与 read_item 返回的当前值一致。`,
  parameters: {
    type: 'object',
    properties: {
      itemId: { type: 'string', description: '要修改的时间轴 clip ID。' },
      match: {
        type: 'object',
        description: '当前属性匹配条件，值必须来自 read_item。',
      },
      apply: {
        type: 'object',
        description: '属性修改内容，键必须与 match 完全相同。',
      },
    },
    required: ['itemId', 'match', 'apply'],
    additionalProperties: false,
  },
}
