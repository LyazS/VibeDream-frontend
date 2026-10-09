import type { ModelTool } from '../../transport/AgentClient'

export const removeItemDefinition: ModelTool = {
  name: 'remove_item',
  description: `What It Does
-------------
删除一个或多个时间轴 item，可混合普通 clip ID 和虚拟 transition item ID，并作为一次撤销/重做操作提交。

Use When
---------
- 需要删除时间轴 clip
- 需要删除某个已配置的转场
- 需要在一次操作中同时删除多个 clip 和转场

Do NOT Use When
---------------
- 需要删除素材库素材时；本工具只删除时间轴 item
- 需要删除整条轨道时，应使用 remove_track
- 只需要替换转场模板时，应使用 apply_transition

Returns
--------
{
  "tool": "remove_item",                 // 工具名
  "removedItemIds": ["<itemId>"]          // 去重后实际删除的 clip 或 transition item ID
}

{
  "tool": "remove_item",                 // 工具名
  "error": "<errorMessage>"               // item 不存在、转场 ID 失效或预检失败的说明
}

Limitations
-----------
普通 clip ID 会删除时间轴片段并保留空隙。转场 ID 必须来自 read_tracks/read_item，格式为 transition:<leftClipId>:<templateId>；若模板已被替换，工具会拒绝删除新的转场。`,
  parameters: {
    type: 'object',
    properties: {
      itemIds: {
        type: 'array',
        items: {
          type: 'string',
        },
        minItems: 1,
        description: '要删除的 clip 或 transition item ID 数组；重复 ID 会自动去重。',
      },
    },
    required: ['itemIds'],
    additionalProperties: false,
  },
}
