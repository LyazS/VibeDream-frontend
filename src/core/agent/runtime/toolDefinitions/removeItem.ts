import type { ModelTool } from '../../transport/AgentClient'

export const removeItemDefinition: ModelTool = {
  name: 'remove_item',
  description: `What It Does
-------------
删除一个或多个时间轴 clip，并作为一次撤销/重做操作提交。

Use When
---------
- 需要删除时间轴 clip

Do Not Use When
---------------
- 需要删除素材库素材时，应使用素材库工具
- 需要删除整条轨道时，应使用 remove_track

Returns
--------
{
  "tool": "remove_item",
  "removedItemIds": ["<clipId>"]
}

Limitations
-----------
itemIds 必须是来自 read_tracks 或用户明确提供的 clip ID 数组。重复 ID 会自动去重。`,
  parameters: {
    type: 'object',
    properties: {
      itemIds: {
        type: 'array',
        items: { type: 'string' },
        minItems: 1,
        description: '要删除的时间轴 clip ID 数组。',
      },
    },
    required: ['itemIds'],
    additionalProperties: false,
  },
}
