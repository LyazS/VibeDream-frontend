import type { ModelTool } from '../../transport/AgentClient'

export const readMediaDefinition: ModelTool = {
  name: 'read_media',
  description: `What It Does
-------------
读取一个或多个素材的详情信息。

Use When
---------
- 需要读取素材基础信息、时长、类型或摘要
- 需要读取视频素材的分镜信息

Do NOT Use When
---------------
- 需要按目录浏览素材库时，应使用 list_media
- 需要按内容语义搜索素材时，应使用 search_media
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
      "summary": "<summary>",             // 素材摘要
      "segments": [                       // 视频分镜列表
        {
          "index": "<index>",             // 分镜序号
          "clipStart": "<clipStart>",     // 分镜开始时间码
          "clipEnd": "<clipEnd>",         // 分镜结束时间码
          "title": "<title>",             // 分镜标题
          "summary": "<summary>"          // 分镜摘要
        }
      ],
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
默认返回 basic 和 summary。includeSegments 为 true 时额外返回视频分镜。
如果内容分析或分镜分析不可用，工具会在 error 或 warning 中说明。`,
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
          '素材 ID 数组，1-10 个。仅用于读取已知素材；如果还没有 mediaId，应先通过 list_media 或 search_media 获取。必须使用完整原始 mediaId，不要截断、补全、翻译或修改扩展名。',
        minItems: 1,
        maxItems: 10,
      },
      includeSegments: {
        type: 'boolean',
        description:
          '是否额外返回视频分镜。默认 false；只有需要选择视频片段、裁切源区间或分析分镜时才设为 true。',
      },
    },
    required: ['mediaIds'],
    additionalProperties: false,
  },
}
