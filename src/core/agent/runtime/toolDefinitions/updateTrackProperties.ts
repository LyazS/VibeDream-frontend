import type { ModelTool } from '../../transport/AgentClient'

export const updateTrackPropertiesDefinition: ModelTool = {
  name: 'update_track_properties',
  description: `What It Does
-------------
修改指定轨道的名称、可见性或静音状态。

Use When
---------
- 需要修改轨道名称、可见性或静音状态
- 只需要改少量静态属性，而不是增删轨道或调整轨道顺序

Do NOT Use When
---------------
- 需要新增轨道时，应使用 add_track
- 需要移动轨道顺序时，应使用 move_track
- 需要删除轨道时，应使用 remove_track

Examples
--------
把轨道从可见改为隐藏：
{
  "trackId": "track_123",
  "match": { "visible": true },
  "apply": { "visible": false }
}

同时重命名并静音：
{
  "trackId": "track_456",
  "match": { "name": "旁白", "muted": false },
  "apply": { "name": "男声旁白", "muted": true }
}

Returns
--------
{
  "tool": "update_track_properties",      // 工具名
  "trackId": "<trackId>",                 // 被修改的轨道 ID
  "before": {                             // 修改前属性；只包含本次修改涉及的字段
    "name": "<oldName>",                  // 轨道名称
    "visible": "<oldVisible>",            // 轨道可见性
    "muted": "<oldMuted>"                 // 轨道静音状态
  },
  "after": {                              // 修改后属性；只包含本次修改涉及的字段
    "name": "<newName>",
    "visible": "<newVisible>",
    "muted": "<newMuted>"
  }
}

{
  "tool": "update_track_properties",      // 工具名
  "error": "<errorMessage>"               // 错误说明
}

Limitations
-----------
match 和 apply 的 key 集合必须一致。
audio 轨道不支持 visible，text 轨道不支持 muted。`,
  parameters: {
    type: 'object',
    properties: {
      trackId: {
        type: 'string',
        description: '要修改的轨道 ID。必须来自 list_tracks 返回的 trackId。',
      },
      match: {
        type: 'object',
        description:
          '当前属性匹配条件，键为轨道属性名，值为预期旧值。必须来自最近一次 list_tracks 返回的轨道属性；用于防止覆盖用户或编辑环境刚刚产生的变化。',
      },
      apply: {
        type: 'object',
        description:
          '属性修改内容，键为轨道属性名，值为新值。key 集合必须与 match 完全一致。支持 name、visible、muted。',
      },
    },
    required: ['trackId', 'match', 'apply'],
  },
}
