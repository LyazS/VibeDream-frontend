import type { ModelTool } from '../../transport/AgentClient'

export const readMediaDefinition: ModelTool = {
  name: 'read_media',
  description: `What It Does
-------------
读取一个或多个素材的详情信息。

Use When
---------
- 需要读取素材基础信息、时长或类型

Do NOT Use When
---------------
- 需要按目录浏览素材库时，应使用 list_media
- 需要读取时间轴 clip 状态，应使用 read_item

Returns
--------
{
  "tool": "read_media",                   // 工具名
  "mediaItems": [
    {
      "mediaId": "<mediaId>",             // 素材 ID
      "status": "<status>",               // found、not_found 或 failed
      "mediaType": "<mediaType>",         // 素材类型
      "basic": {                          // 素材基础信息
        "name": "<name>",                 // 素材名称
        "width": "<width>",               // video/image 的原始宽度
        "height": "<height>",             // video/image 的原始高度
        "duration": "<duration>"          // video/audio 的时长，格式 HH:MM:SS+FF
      },
      "warning": "<warningMessage>",      // 警告信息
      "error": "<errorMessage>"           // 错误信息
    }
  ]
}

{
  "tool": "read_media",                   // 工具名
  "code": "<errorCode>",                  // 错误码
  "error": "<errorMessage>"               // 错误说明
}

等待分析结束后按原始 mediaId 重新读取本地信息，basic.name 使用当前名称；素材移动不影响读取，已删除则返回 not_found。
分析失败仍返回可用 basic，并通过 failed 状态和 error 说明失败；分镜部分失败通过 warning 说明。
ID 必须完整、原样使用，不去空格、补全或替换。相近 ID 仅可能出现在错误建议中，不会代替输入读取。

Limitations
-----------
只返回素材的 basic 信息，不触发内容索引或分析。`,
  parameters: {
    type: 'object',
    properties: {
      mediaIds: {
        type: 'array',
        items: {
          type: 'string',
          minLength: 1,
          description: '素材 ID。',
        },
        description:
          '素材 ID 数组，1-10 个。仅用于读取已知素材；如果还没有 mediaId，应先通过 list_media 获取。必须使用完整原始 mediaId，不要截断、补全、翻译或追加文件扩展名。',
        minItems: 1,
        maxItems: 10,
      },
    },
    required: ['mediaIds'],
    additionalProperties: false,
  },
}
