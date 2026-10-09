import type { ModelTool } from '../../transport/AgentClient'

export const modifyProjectInfoDefinition: ModelTool = {
  name: 'modify_project_info',
  description: `What It Does
-------------
修改当前工程的名称、描述或画布尺寸。

Use When
---------
- 需要修改工程名称
- 需要修改工程描述
- 需要切换画布预设尺寸或设置自定义宽高

Do NOT Use When
---------------
- 需要先查看当前工程信息时，应使用 read_project_info
- 需要修改轨道、片段或素材时，应使用对应编辑工具

Returns
--------
{
  "tool": "modify_project_info",         // 工具名
  "before": {                            // 修改前工程信息
    "name": "<oldName>",                 // 修改前工程名称
    "description": "<oldDescription>",   // 修改前工程描述
    "canvas": {                          // 修改前画布信息
      "width": "<oldWidth>",             // 修改前画布宽度（像素）
      "height": "<oldHeight>",           // 修改前画布高度（像素）
      "presetKey": "<oldPresetKey>"      // 修改前预设尺寸 key；自定义尺寸时为 null
    }
  },
  "after": {                             // 修改后工程信息
    "name": "<newName>",                 // 修改后工程名称
    "description": "<newDescription>",   // 修改后工程描述
    "canvas": {                          // 修改后画布信息
      "width": "<newWidth>",             // 修改后画布宽度（像素）
      "height": "<newHeight>",           // 修改后画布高度（像素）
      "presetKey": "<newPresetKey>"      // 修改后预设尺寸 key；自定义尺寸时为 null
    }
  }
}

{
  "tool": "modify_project_info",         // 工具名
  "error": "<errorMessage>"              // 错误说明
}

Limitations
-----------
match 和 apply 的顶层 key 集合必须一致。canvas 只支持使用 presetKey 切换预设，或使用 width/height 设置尺寸。`,
  parameters: {
    type: 'object',
    properties: {
      match: {
        type: 'object',
        description:
          '当前工程信息匹配条件。键只支持 name、description、canvas；必须来自最近一次 read_project_info 返回，用于防止覆盖用户刚刚修改过的值。',
        properties: {
          name: {
            type: 'string',
            description: '当前工程名称。必须与 read_project_info 返回的 name 完全一致。',
          },
          description: {
            type: 'string',
            description: '当前工程描述。必须与 read_project_info 返回的 description 完全一致。',
          },
          canvas: {
            type: 'object',
            description:
              '当前画布完整信息。必须完整包含 width、height、presetKey，并与 read_project_info 返回的 canvas 完全一致。',
            properties: {
              width: {
                type: 'integer',
                minimum: 1,
              },
              height: {
                type: 'integer',
                minimum: 1,
              },
              presetKey: {
                type: ['string', 'null'],
                description: '当前画布对应的预设 key；自定义尺寸时为 null。',
              },
            },
            required: ['width', 'height', 'presetKey'],
            additionalProperties: false,
          },
        },
        additionalProperties: false,
      },
      apply: {
        type: 'object',
        description: '要应用的新工程信息。顶层 key 集合必须与 match 完全一致。',
        properties: {
          name: {
            type: 'string',
            description: '新的工程名称。必须是非空字符串。',
          },
          description: {
            type: 'string',
            description: '新的工程描述。可为空字符串。',
          },
          canvas: {
            type: 'object',
            description:
              '新的画布设置。二选一：只传 presetKey 切换到预设尺寸，或只传 width 和 height 设置自定义尺寸。',
            properties: {
              presetKey: {
                type: 'string',
                description: '目标预设尺寸 key。必须是系统支持的稳定 presetKey。',
              },
              width: {
                type: 'integer',
                minimum: 1,
                description: '目标画布宽度。与 height 一起传入，用于设置自定义尺寸。',
              },
              height: {
                type: 'integer',
                minimum: 1,
                description: '目标画布高度。与 width 一起传入，用于设置自定义尺寸。',
              },
            },
            additionalProperties: false,
          },
        },
        additionalProperties: false,
      },
    },
    required: ['match', 'apply'],
    additionalProperties: false,
  },
}
