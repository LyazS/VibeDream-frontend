import type { ModelTool } from '../../transport/AgentClient'

export const moveLibraryItemsDefinition: ModelTool = {
  name: 'move_library_items',
  description: `What It Does
-------------
将一个或多个素材、文件夹或混合项目移动到目标文件夹。整个操作只写入一条可撤销历史记录。

Use When
---------
- 用户要求整理素材库、移动选中素材或移动文件夹

Do NOT Use When
---------------
- 需要复制素材；素材库当前只支持移动
- 目标、来源或项目身份不明确时；应先使用 list_media、被动上下文或 ask_user

Returns
-------
{
  "tool": "move_library_items",
  "before": [{ "parentDirId": "<sourceDirId>" }],
  "after": [{ "parentDirId": "<targetDirId>" }]
}

{
  "tool": "move_library_items",
  "error": "<errorMessage>",
  "code": "<errorCode>",
  "details": { "current": { "itemId": "<itemId>", "name": "<name>", "parentDirId": "<parentDirId>" } }
}

before、after 与输入 items 顺序一一对应，仅返回直接父目录 ID；项目 ID 和名称沿用输入值。
details.current 仅在 state_mismatch 时提供，说明校验失败项目的当前状态。
来源不存在返回 item_not_found，目标不存在返回 directory_not_found，ID 同时对应文件夹和素材返回 ambiguous_item_id。
重复来源返回 duplicate_item，同名文件夹冲突返回 duplicate_name，不合法移动返回 invalid_move。
保存失败并恢复原位置返回 persistence_failed；恢复失败返回 rollback_failed，应重新读取实际状态。
state_mismatch 后重新读取并判断，不自动覆盖 match 并机械重试。
itemId、targetDirId 必须来自实际读取结果、写工具结果或本轮工程上下文，不自行构造、缩写或补全。
用户只给出路径时，从根目录逐层读取并选择目录 ID，必要时继续分页。同名项目按 ID 区分。

Examples
--------
混合移动：{"items":[{"itemId":"dir_shots","match":{"name":"镜头","parentDirId":"dir_videos"}},{"itemId":"media_music","match":{"name":"配乐.wav","parentDirId":"dir_root"}}],"targetDirId":"dir_selected"}

Limitations
-----------
match.name 和 match.parentDirId 必须与最近读取的值完全一致；祖先目录改名或移动不影响校验，目标目录按 ID 定位。
不能移动根目录、移动到当前父目录、移动到自身/后代，或同时移动文件夹及其内部文件夹或媒体。
目标同名文件夹或批次内同名文件夹会被拒绝，不自动合并或编号。媒体允许同名，也可以与文件夹同名。
效果模板等未支持对象返回 unsupported_item_kind。`,
  parameters: {
    type: 'object',
    properties: {
      items: {
        type: 'array',
        minItems: 1,
        description: '全部待移动项目；每项提供最近读取的名称和直接父目录 ID。',
        items: {
          type: 'object',
          properties: {
            itemId: {
              type: 'string',
              minLength: 1,
              description: '待移动项目的完整原始 ID；文件夹填 dirId 的值，媒体填 mediaId 的值。',
            },
            match: {
              type: 'object',
              properties: {
                name: {
                  type: 'string',
                  minLength: 1,
                  description: '最近一次读取的当前名称，逐字保留，不自行修剪或改写。',
                },
                parentDirId: {
                  type: 'string',
                  minLength: 1,
                  description: '最近一次读取的直接父目录 ID，用于状态校验。',
                },
              },
              required: ['name', 'parentDirId'],
              additionalProperties: false,
            },
          },
          required: ['itemId', 'match'],
          additionalProperties: false,
        },
      },
      targetDirId: {
        type: 'string',
        minLength: 1,
        description: '全部待移动项目的目标目录 ID。',
      },
    },
    required: ['items', 'targetDirId'],
    additionalProperties: false,
  },
}
