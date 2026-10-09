import type { ModelTool } from '../../transport/AgentClient'

export const searchTransitionsDefinition: ModelTool = {
  name: 'search_transitions',
  description: `What It Does
-------------
按自然语言检索可用转场模板。

Use When
---------
- 需要添加转场特效，且需要根据用户描述选择合适模板

Do NOT Use When
---------------
- 已知明确的 templateId 时，无需搜索，直接使用 apply_transition
- 需要读取已配置转场的时长或参数时，应使用 read_item

Returns
--------
{
  "tool": "search_transitions",          // 工具名
  "results": [                            // 按相关性排序的转场模板候选
    {
      "templateId": "<templateId>",      // 用于 apply_transition 的模板 ID
      "name": "<englishName>",           // 模板英文名称
      "description": "<description>"     // 模板的语义检索描述
    }
  ]
}

{
  "tool": "search_transitions",          // 工具名
  "error": "<errorMessage>"               // 检索失败或参数无效的说明
}

Limitations
-----------
结果只用于选择模板，不返回检索分数。Agent 必须结合用户意图、名称和 description 自行判断候选是否合适，不能将返回顺序视为最终推荐。
模板默认参数会由 apply_transition 在创建转场时加载。`,
  parameters: {
    type: 'object',
    properties: {
      query: {
        type: 'string',
        description: '描述所需转场视觉风格、运动或剪辑意图的自然语言查询。',
      },
      topK: {
        type: 'integer',
        minimum: 1,
        maximum: 10,
        description: '返回候选数量，默认 5。',
      },
    },
    required: ['query'],
    additionalProperties: false,
  },
}
