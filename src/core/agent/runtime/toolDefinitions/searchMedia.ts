import type { ModelTool } from '../../transport/AgentClient'

export const searchMediaDefinition: ModelTool = {
  name: 'search_media',
  description: `What It Does
-------------
按自然语言在当前项目内检索图片素材和视频分片候选。

Use When
---------
- 需要“找素材”“找镜头”或“搜索某类图片或视频片段”
- 需要根据画面、内容、动作、人物、场景或语义描述找候选素材
- 需要先找到候选，再读取详情或插入时间轴

Do NOT Use When
---------------
- 需要按目录浏览素材库时，应使用 list_media
- 需要素材详情时，应使用 read_media
- 需要查看时间轴上已有片段时，应使用 read_item

Returns
--------
{
  "tool": "search_media",                 // 工具名
  "query": "<query>",                     // 本次检索词
  "requestedTopK": "<topK>",              // 请求返回的候选数量
  "results": [
    {
      "type": "<mediaType>",              // 候选素材类型；video 或 image
      "mediaId": "<mediaId>",             // 候选素材 ID
      "mediaName": "<mediaName>",         // 候选素材名称
      "verdict": "<verdict>",             // 检索校验结论
      "segment": {                        // 命中的视频分段
        "index": "<segmentIndex>",        // 分段序号
        "clipStart": "<clipStart>",       // 分段开始时间码
        "clipEnd": "<clipEnd>"            // 分段结束时间码
      },
      "evidence": "<reason>"              // 检索校验依据
    }
  ]
}

{
  "tool": "search_media",                 // 工具名
  "error": "<errorMessage>"               // 错误说明
}

Limitations
-----------
仅支持检索 video 和 image 素材。
工具会在检索前自动补齐可搜索素材的索引；若索引失败，检索可能失败或结果不完整。
evidence 是检索校验依据，不是正式素材摘要；需要素材完整详情时继续调用 read_media。`,
  parameters: {
    type: 'object',
    properties: {
      query: {
        type: 'string',
        description:
          '自然语言检索词。应来自用户对画面、内容、动作、人物、场景或素材类型的描述；不要填目录路径或 mediaId。',
      },
      top_k: {
        type: 'integer',
        description: '希望返回的候选数量，范围 1-10。默认 5；用户要求多个备选时适当增大。',
        minimum: 1,
        maximum: 10,
      },
    },
    required: ['query'],
  },
}
