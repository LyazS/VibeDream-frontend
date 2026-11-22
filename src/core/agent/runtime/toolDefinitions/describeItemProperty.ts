import type { ModelTool } from '../../transport/AgentClient'

export const describeItemPropertyDefinition: ModelTool = {
  name: 'describe_item_property',
  description: `What It Does
-------------
根据属性 ID 与用途返回 clip 属性的结构化编辑说明。

Use When
---------
- 不确定属性值类型、范围、步长、可选值或编辑含义
- 修改 clip 静态属性或关键帧前，需要解析正确的 propertyId

Examples
--------
clip 静态属性：
{
  "propertyIds": ["visual.position.x"],
  "usage": "static_edit"
}

clip 关键帧属性，可一次查询多个属性：
{
  "propertyIds": ["visual.position.x", "visual.size.width"],
  "usage": "keyframe_edit"
}

Returns
--------
{
  "tool": "describe_item_property",
  "usage": "static_edit|keyframe_edit",
  "propertyIds": ["<propertyId>"],
  "propertyDescriptions": [
    {
      "requestedPropertyId": "<propertyId>",
      "success": true,
      "resolvedPropertyId": "<propertyId>",
      "targetKind": "leaf|property",
      "groupId": "<groupId>",
      "valueType": "<type>",
      "editable": true,
      "animatable": false,
      "constraints": ["<constraint>"],
      "min": "<min>",
      "max": "<max>",
      "step": "<step>",
      "options": [],
      "propertyId": "<propertyId>",
      "valueShape": { "kind": "object", "keys": [] },
      "componentHint": "<componentHint>",
      "description": "<description>"
    }
  ]
}

Limitations
-----------
clip 只接受 static_edit 或 keyframe_edit，且不传 templateId。`,
  parameters: {
    type: 'object',
    properties: {
      propertyIds: {
        type: 'array',
        items: { type: 'string' },
        minItems: 1,
        description: '要查询的完整属性路径数组。',
      },
      usage: {
        type: 'string',
        enum: ['static_edit', 'keyframe_edit'],
        description: 'clip 使用 static_edit 或 keyframe_edit。',
      },
    },
    required: ['propertyIds', 'usage'],
    additionalProperties: false,
  },
}
