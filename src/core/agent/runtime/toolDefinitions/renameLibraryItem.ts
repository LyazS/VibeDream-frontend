import type { ModelTool } from '../../transport/AgentClient'

export const renameLibraryItemDefinition: ModelTool = {
  name: 'rename_library_item',
  description: `What It Does
-------------
重命名一个素材库文件夹或媒体，支持撤销和重做。

Use When
---------
- 用户要求修改已知文件夹或素材的名称

Do NOT Use When
---------------
- 需要移动项目，应使用 move_library_items
- 目标身份或当前名称不明确时；应先使用 list_media、被动上下文或 ask_user

Returns
-------
{
  "tool": "rename_library_item",
  "before": { "name": "<oldName>" },
  "after": { "name": "<newName>" }
}

{
  "tool": "rename_library_item",
  "error": "<errorMessage>",
  "code": "<errorCode>",
  "details": { "current": { "name": "<name>" } }
}

before、after 只提供重命名前后的名称；后续操作沿用输入的 itemId。
details.current 仅在 state_mismatch 时提供，用于说明项目当前状态。
itemId 不存在返回 item_not_found；ID 同时对应文件夹和素材时返回 ambiguous_item_id。
名称非法返回 invalid_name，文件夹同级重名返回 duplicate_name，名称不变返回 no_change。
state_mismatch 后重新读取并判断，不自动覆盖 match 并机械重试。

Examples
--------
重命名文件夹：{"itemId":"dir_shots","match":{"name":"镜头"},"newName":"精选镜头"}
重命名媒体：{"itemId":"media_take01.mp4","match":{"name":"镜头01.mp4"},"newName":"开场.mp4"}

Limitations
-----------
根目录不能重命名，效果模板等未支持对象返回 unsupported_item_kind。
match.name 必须与最近读取的名称完全一致；项目或祖先目录移动不影响校验。
同级文件夹名称区分大小写且不能重复；媒体允许同名，也可以与文件夹同名。`,
  parameters: {
    type: 'object',
    properties: {
      itemId: {
        type: 'string',
        minLength: 1,
        description:
          '待重命名项目的完整原始 ID，必须来自实际读取结果、写工具结果或本轮工程上下文；文件夹填 dirId 的值，媒体填 mediaId 的值。',
      },
      match: {
        type: 'object',
        properties: {
          name: {
            type: 'string',
            minLength: 1,
            description: '最近一次读取的当前名称，逐字保留，不自行修剪或改写。',
          },
        },
        required: ['name'],
        additionalProperties: false,
      },
      newName: {
        type: 'string',
        minLength: 1,
        description:
          '新名称，不能为空。文件夹名称不能为 . 或 ..，不能含斜杠、反斜杠或控制字符，且不能与同级文件夹同名。',
      },
    },
    required: ['itemId', 'match', 'newName'],
    additionalProperties: false,
  },
}
