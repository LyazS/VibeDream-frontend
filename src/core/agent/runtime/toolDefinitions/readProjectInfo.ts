import type { ModelTool } from '../../transport/AgentClient'

export const readProjectInfoDefinition: ModelTool = {
  name: 'read_project_info',
  description: `What It Does
-------------
读取当前工程的名称、描述和画布尺寸信息。

Use When
---------
- 需要查看当前工程名称或描述
- 需要查看当前画布宽高或对应的预设尺寸
- 修改工程信息前，需要先读取当前值

Do NOT Use When
---------------
- 需要修改工程信息时，应使用 modify_project_info
- 需要读取时间轴、轨道或素材信息时，应使用对应读取工具

Returns
--------
{
  "tool": "read_project_info",           // 工具名
  "name": "<name>",                      // 当前工程名称
  "description": "<description>",        // 当前工程描述
  "canvas": {                            // 当前画布信息
    "width": "<width>",                  // 画布宽度（像素）
    "height": "<height>",                // 画布高度（像素）
    "presetKey": "<presetKey>"           // 命中的预设尺寸 key；自定义尺寸时为 null
  }
}

{
  "tool": "read_project_info",           // 工具名
  "error": "<errorMessage>"              // 错误说明
}

Limitations
-----------
只返回最小工程信息，不返回项目 ID、时间戳、版本号或其他设置。`,
  parameters: {
    type: 'object',
    properties: {},
    required: [],
    additionalProperties: false,
  },
}
