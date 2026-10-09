import type { ModelTool } from '../../transport/AgentClient'

export const listMediaDefinition: ModelTool = {
  name: 'list_media',
  description: `What It Does
-------------
浏览当前项目素材库中某个目录的直接子项。

Use When
---------
- 需要查看素材库、文件夹或某个目录下有什么
- 需要按目录逐层浏览素材
- 需要先取得素材 mediaId，再读取素材详情或插入时间轴

Do NOT Use When
---------------
- 需要按内容语义找镜头、图片或视频片段时，应使用 search_media
- 需要读取素材详情时，应使用 read_media
- 需要查看时间轴轨道或 clip，应使用 read_tracks/read_item

Returns
--------
{
  "tool": "list_media",                   // 工具名
  "path": "<path>",                       // 当前返回结果对应的规范目录路径
  "entries": [
    {
      "type": "directory",                // 目录条目
      "name": "<directoryName>"           // 目录名；可继续拼接到路径中做下一次 list_media
    },
    {
      "type": "media",                    // 素材条目
      "mediaId": "<mediaId>",             // 完整素材 ID
      "name": "<mediaName>",              // 用户定义的素材名
      "mediaType": "<mediaType>",         // 素材类型
      "title": "<title>",                 // 可选；视觉识别生成的标题
      "shots": "<shotCount>"              // 可选；视频分镜数量
    }
  ],
  "page": {
    "offset": "<offset>",                 // 本次返回的起始位置，1-based
    "limit": "<limit>",                   // 本次请求的返回上限
    "total": "<total>",                   // 当前目录下条目总数
    "nextOffset": "<nextOffset>"          // 下一页起始位置；没有下一页时为 null
  }
}

{
  "tool": "list_media",                   // 工具名
  "error": "<errorMessage>"               // 错误说明
}

Limitations
-----------
只返回当前目录直接子项，不递归。`,
  parameters: {
    type: 'object',
    properties: {
      filePath: {
        type: 'string',
        description:
          "要浏览的素材目录名称路径。必须以 '/' 开头，例如 '/'、'/视频/'、'/角色/张三/'。可直接使用用户指定的目录，或基于上一次 list_media 返回的 directory name 继续拼接。",
      },
      offset: {
        type: 'integer',
        description:
          '分页起始位置，1-indexed。省略时从第 1 个条目开始；当上一次返回结果未覆盖全部条目时，用于继续翻页。',
        minimum: 1,
      },
      limit: {
        type: 'integer',
        description: '本次最多返回的条目数。省略时默认返回 20 条；当只需快速预览时可取较小值。',
        minimum: 1,
      },
    },
    required: ['filePath'],
    additionalProperties: false,
  },
}
