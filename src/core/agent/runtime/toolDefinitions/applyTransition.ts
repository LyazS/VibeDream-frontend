import type { ModelTool } from '../../transport/AgentClient'

export const applyTransitionDefinition: ModelTool = {
  name: 'apply_transition',
  description: `What It Does
-------------
在视频轨道上一对相邻视觉 clip 的精确拼接点应用转场模板。

Use When
---------
- 需要在两个相邻视觉 clip 的拼接点添加转场特效
- 需要替换该拼接点当前转场的模板

Do NOT Use When
---------------
- 需要仅调整已存在转场的时长或参数时，应使用 update_item
- 需要删除转场时，应使用 remove_item
- 左右 clip 不相邻、不是视频/图片视觉 clip，或拼接点不明确时

Returns
--------
{
  "tool": "apply_transition",                         // 工具名
  "itemId": "transition:<leftClipId>:<templateId>",   // 新建转场的虚拟时间轴 item ID
  "item": {                                           // 新建转场的摘要
    "leftClipId": "<leftClipId>",                     // 持久化转场配置的左侧 clip ID
    "rightClipId": "<rightClipId>",                   // 当前与左侧 clip 相邻的右侧 clip ID
    "seamTime": "<timecode>",                         // 转场所在拼接点，格式 HH:MM:SS+FF
    "transition": {                                   // 转场配置
      "templateId": "<templateId>",                   // 实际应用的模板 ID
      "duration": "<timecode>",                       // 模板默认的配置时长，不是有效时长
      "params": { ... }                               // 模板默认参数
    }
  }
}

{
  "tool": "apply_transition",            // 工具名
  "error": "<errorMessage>"               // 无效目标、模板未就绪、目标过期或范围重叠的说明
}

Limitations
-----------
trackId 必须是视频轨。seamTime 必须同时等于 leftClipId 的结束时间和 rightClipId 的开始时间；工具会在异步安装模板后再次校验目标，拼接点发生变化会拒绝写入。`,
  parameters: {
    type: 'object',
    properties: {
      trackId: {
        type: 'string',
        description: '目标轨道 ID，必须来自 list_tracks/read_tracks。',
      },
      leftClipId: {
        type: 'string',
        description: '拼接点左侧 clip ID，必须来自 read_tracks。',
      },
      rightClipId: {
        type: 'string',
        description: '拼接点右侧且当前相邻的 clip ID，用于并发保护。',
      },
      seamTime: {
        type: 'string',
        description: '目标拼接时间，格式 HH:MM:SS+FF，必须同时等于左右 clip 边界。',
      },
      templateId: {
        type: 'string',
        description: 'search_transitions 返回的转场模板 ID。',
      },
    },
    required: ['trackId', 'leftClipId', 'rightClipId', 'seamTime', 'templateId'],
    additionalProperties: false,
  },
}
