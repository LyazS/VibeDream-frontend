import type { ModelTool } from '../../transport/AgentClient'

export const readItemDefinition: ModelTool = {
  name: 'read_item',
  description: `What It Does
-------------
读取一个时间轴 item 的结构化属性。普通 clip 支持原有属性组；虚拟转场支持 timeline 和 transition 属性组。

Use When
---------
- 修改 clip 或转场前，需要读取当前值作为 update_item 的 match 条件
- 准备修改 clip 静态属性，需要读取 visual、audio、text、mask 或 timeline 属性组
- 需要在当前播放头或指定时间点读取受关键帧动画影响后的 clip 实际属性值
- 需要确认 clip 所在轨道、时间范围或源区间，再进行 move_clip、trim_clip 或 split_clip
- 需要确认转场绑定的左右 clip、有效时长、实际展示范围或参数

Do NOT Use When
---------------
- 需要先在轨道中定位 item 时，应使用 read_tracks
- 需要读取关键帧动画时，应使用 read_clip_keyframe
- 需要读取素材库素材详情时，应使用 read_media

Returns
--------
clip item 示例：
{
  "tool": "read_item",                   // 工具名
  "itemId": "<clipId>",                  // 被读取的时间轴 clip ID
  "itemType": "clip",                    // item 类型
  "mediaType": "<mediaType>",            // clip 媒体类型
  "sampleTime": "<timecode>",            // 请求语义上的绝对采样时间；始终存在
  "groups": {                            // 按请求 propertyGroups 返回的属性组
    "visual": { ... },                   // 画面属性组
    "audio": { ... },                    // 音量和静音状态
    "text": { ... },                     // 文本内容和文本样式
    "mask": { ... },                     // 蒙版属性组
    "timeline": { ... }                  // 轨道归属、时间轴区间和素材源区间
  }
}

transition item 示例：
{
  "tool": "read_item",                   // 工具名
  "itemId": "<transitionItemId>",        // 被读取的虚拟 transition item ID
  "itemType": "transition",              // item 类型
  "groups": {                             // 按请求 propertyGroups 返回的属性组
    "timeline": { ... },                  // 左右 clip、轨道、拼接点、有效范围、有效时长和绑定状态
    "transition": { ... }                 // 模板 ID、配置时长和当前参数
  }
}

{
  "tool": "read_item",                   // 工具名
  "error": "<errorMessage>"               // item 不存在、ID 失效或属性组不受支持的说明
}

Limitations
-----------
clip 支持 visual、audio、text、mask、timeline；读取多个 group 时，只要任一 group 无效或不受支持则整次失败。未传 sampleTime 时，clip 默认使用当前播放头时间；请求时间越过 clip 边界时，内部在最近边界取值，但 sampleTime 仍回显原始请求时间。当前只有受支持的 visual/audio 动画属性会按采样时间返回实际值，关键帧记录本身仍应使用 read_clip_keyframe。

transition itemId 必须使用 read_tracks/apply_transition 返回的完整 ID。转场只允许 timeline 和 transition；其 duration 是配置时长，timeline.effectiveDuration 才是受 clip 可用帧数限制后的实际时长。`,
  parameters: {
    type: 'object',
    properties: {
      itemId: {
        type: 'string',
        description:
          '时间轴 clip ID，或 read_tracks/apply_transition 返回的完整 transition item ID。若尚未定位目标，应先调用 read_tracks。',
      },
      propertyGroups: {
        type: 'array',
        items: {
          type: 'string',
        },
        minItems: 1,
        description:
          '要读取的属性组。clip 支持 visual、audio、text、mask、timeline；transition 只支持 timeline、transition。多个 group 中任一项无效会使整次读取失败。',
      },
      sampleTime: {
        type: 'string',
        description:
          '仅 clip 可用的可选绝对采样时间，格式 HH:MM:SS+FF。未传时默认当前播放头；越过 clip 边界时在最近边界取值，但返回仍回显原始请求时间。',
      },
    },
    required: ['itemId', 'propertyGroups'],
    additionalProperties: false,
  },
}
