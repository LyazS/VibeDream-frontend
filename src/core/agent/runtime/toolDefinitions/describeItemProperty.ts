import type { ModelTool } from '../../transport/AgentClient'

export const describeItemPropertyDefinition: ModelTool = {
  name: 'describe_item_property',
  description: `What It Does
-------------
根据属性 ID 与用途返回 clip 或转场属性的结构化编辑说明。

Use When
---------
- 不确定属性值类型、范围、步长、可选值或编辑含义
- 修改转场参数前，需要确认 transition.params.<parameterKey> 的模板 schema
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

转场属性：
{
  "propertyIds": ["transition.duration", "transition.params.adjust"],
  "usage": "transition_edit",
  "templateId": "gl-bow-tie-with-parameter"
}

Returns
--------
{
  "tool": "describe_item_property",       // 工具名
  "usage": "<usage>",                     // 本次解析用途：static_edit、keyframe_edit 或 transition_edit
  "templateId": "<templateId>",           // transition_edit 时对应的模板 ID
  "propertyIds": ["<propertyId>"],         // 去重后的请求属性路径；clip 场景不返回 templateId
  "propertyDescriptions": [                // 与请求 propertyIds 对应的说明结果
    {
      "requestedPropertyId": "<propertyId>", // 原始请求属性路径
      "success": true,                     // 是否成功解析该属性
      "resolvedPropertyId": "<propertyId>", // 当前用途下真正应操作或读取的属性路径
      "targetKind": "leaf|property",      // leaf 为直接字段；property 为关键帧属性
      "groupId": "<groupId>",             // 属性组，例如 visual、timeline、transition
      "valueType": "<type>",              // 值类型，例如 number、timecode、enum
      "editable": true,                     // 是否可通过对应编辑工具修改
      "animatable": false,                  // 是否支持关键帧动画
      "constraints": ["<constraint>"],    // 类型、范围、只读或使用注意事项
      "default": "<default>",             // transition 参数默认值；不适用时为 null/省略
      "min": "<min>",                     // 数值下限；不适用时为 null/省略
      "max": "<max>",                     // 数值上限；不适用时为 null/省略
      "step": "<step>",                   // 建议步长；不适用时为 null/省略
      "options": [],                        // 参数可选值，或 bindingState 的值及说明
      "propertyId": "<propertyId>",       // 仅关键帧 targetKind=property 时返回
      "valueShape": { ... },                // 仅关键帧 targetKind=property 时返回
      "componentHint": "<componentHint>", // 仅复合关键帧字段时返回
      "description": "<description>"      // 字段视觉含义和编辑建议
    },
    {
      "requestedPropertyId": "<propertyId>", // 原始请求属性路径
      "success": false,                    // 当前属性无法解析
      "error": "<errorMessage>"           // 不支持、只读限制或用途不匹配的说明
    }
  ]
}

{
  "tool": "describe_item_property",      // 工具名
  "error": "<errorMessage>"               // usage、templateId 或 propertyIds 不合法的说明
}

Limitations
-----------
clip 只接受 static_edit 或 keyframe_edit，且不传 templateId。
转场必须使用 transition_edit 并传 templateId；
支持只读的 timeline.bindingState、transition.duration 和该模板 manifest 中存在的 transition.params.<parameterKey>。`,
  parameters: {
    type: 'object',
    properties: {
      propertyIds: {
        type: 'array',
        items: {
          type: 'string',
        },
        minItems: 1,
        description: '要查询的完整属性路径数组。',
      },
      usage: {
        type: 'string',
        enum: ['static_edit', 'keyframe_edit', 'transition_edit'],
        description: 'clip 使用 static_edit/keyframe_edit；转场使用 transition_edit。',
      },
      templateId: {
        type: 'string',
        description:
          '仅 transition_edit 必填，使用 search_transitions/apply_transition 的模板 ID。',
      },
    },
    required: ['propertyIds', 'usage'],
    additionalProperties: false,
  },
}
