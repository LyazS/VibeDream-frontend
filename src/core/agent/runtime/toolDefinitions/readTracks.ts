import type { ModelTool } from '../../transport/AgentClient'

export const readTracksDefinition: ModelTool = {
  name: 'read_tracks',
  description: `What It Does
-------------
读取一个或多个指定轨道上的时间轴 item 列表，可按时间范围过滤。items 同时包含 clip 和虚拟转场，并按时间轴顺序混合排列；转场紧跟其左侧 clip，并位于同一拼接点的右侧 clip 之前。

Use When
---------
- 已知一个或多个 trackId，想查看这些轨道上有哪些 clip 或转场
- 需要找某个时间点或时间段内的 itemId、mediaId 或时间范围
- 修改、删除、切分、裁切 clip 或编辑转场前，需要先定位目标 item

Filter Semantics
----------------
- clip 或具有有效展示范围的转场只要与筛选区间有重叠，就应返回
- 无法计算有效范围的转场按 seamTime 是否落在筛选区间内决定是否返回
- 例如 clip 时间范围是 00:00:10+00 到 00:00:20+00，而筛选区间是 00:00:05+00 到 00:00:15+00，该 clip 仍会被返回

Do NOT Use When
---------------
- 需要读取轨道概览或选择目标轨道时，应使用 list_tracks
- 已经有明确 itemId 且需要详细属性，应使用 read_item
- 需要读取素材库素材详情，应使用 read_media

Returns
--------
{
  "tool": "read_tracks",                  // 工具名
  "tracks": [
    {
      "trackId": "<trackId>",             // 轨道 ID
      "items": [                         // 当前轨道命中的 clip 和 transition item
        {
          "itemId": "<clipId>",           // 普通时间轴 clip ID
          "itemType": "clip",             // item 类型
          "mediaId": "<mediaId>",         // 对应素材 ID
          "start": "<start>",             // 时间轴开始时间
          "end": "<end>",                 // 时间轴结束时间
          "mediaType": "<mediaType>"      // 片段类型
        },
        {
          "itemId": "transition:<leftClipId>:<templateId>", // 虚拟转场 item ID
          "itemType": "transition",       // item 类型
          "leftClipId": "<leftClipId>",   // 转场配置所属的左侧 clip ID
          "rightClipId": "<rightClipId>", // 当前右侧相邻 clip ID；无右侧目标时不返回
          "start": "<start>",             // 实际有效展示范围开始；无法计算时不返回
          "end": "<end>"                  // 实际有效展示范围结束；无法计算时不返回
        }
      ],
      "total": "<total>"                  // 当前轨道命中的 item 总数
    },
    {
      "trackId": "<trackId>",             // 轨道 ID
      "error": "<errorMessage>"           // 该轨道读取失败说明
    }
  ],
  "requestedTotal": "<requestedTotal>",   // 输入的轨道 ID 数量
  "total": "<total>",                     // 去重后的轨道数量
  "failedTotal": "<failedTotal>",         // 读取失败的轨道数量
  "filter": {                             // 本次使用的筛选条件
    "start": "<start>",
    "end": "<end>"
  }
}

{
  "tool": "read_tracks",                  // 工具名
  "error": "<errorMessage>"               // 错误说明
}

Limitations
-----------
trackIds 必须是 1-10 个字符串组成的数组，重复 ID 会自动去重并保留首次出现顺序。
start/end 只是共享筛选条件，不会修改时间轴。转场的绑定状态、拼接时间和有效时长属于诊断信息，应通过 read_item 读取。时间码必须使用 HH:MM:SS+FF。`,
  parameters: {
    type: 'object',
    properties: {
      trackIds: {
        type: 'array',
        items: {
          type: 'string',
          description: '轨道 ID。',
        },
        description:
          '要读取的轨道 ID 数组，1-10 个。如果还没有 trackId，应先通过 list_tracks 获取。必须使用 list_tracks 返回的 trackId，或用户明确提供的有效 trackId。重复 ID 会自动去重并保留首次出现顺序。',
        minItems: 1,
        maxItems: 10,
      },
      start: {
        type: 'string',
        description:
          '可选共享筛选起始时间，格式 HH:MM:SS+FF。对所有 trackIds 生效；clip 按时间范围相交、无法计算范围的转场按 seamTime 落点筛选。不是编辑操作。',
      },
      end: {
        type: 'string',
        description:
          '可选共享筛选结束时间，格式 HH:MM:SS+FF。对所有 trackIds 生效；clip 按时间范围相交、无法计算范围的转场按 seamTime 落点筛选。不是编辑操作。',
      },
    },
    required: ['trackIds'],
    additionalProperties: false,
  },
}
