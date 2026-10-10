import type { ModelTool } from '../../transport/AgentClient'

export const deleteEmptyFolderDefinition: ModelTool = {
  name: 'delete_empty_folder',
  description: `What It Does
-------------
删除一个空素材库文件夹。操作会写入项目的撤销/重做历史。

Use When
---------
- 用户要求删除已经确认为空的文件夹

Do NOT Use When
---------------
- 需要删除素材或非空文件夹；这些操作不属于此工具
- 目录身份或当前状态不明确时；应先使用 list_media、被动上下文或 ask_user

Returns
-------
{
  "tool": "delete_empty_folder",
  "after": null
}

{
  "tool": "delete_empty_folder",
  "error": "<errorMessage>",
  "code": "<errorCode>"
}

after: null 表示指定目录已删除，不重复返回已知 ID、名称、父目录或历史记录描述。
目录不存在返回 directory_not_found，根目录返回 root_directory_protected，非空目录返回 directory_not_empty。
dirId 必须来自实际读取结果、写工具结果或本轮工程上下文，不自行构造、缩写或补全。
用户只给出路径时，从根目录逐层读取并选择目录 ID，必要时继续分页。同名目录按 ID 区分。

Examples
--------
删除空文件夹：{"dirId":"dir_empty"}

Limitations
-----------
不能删除根目录。执行时目录必须没有直属媒体且没有子文件夹；目录变为非空时不会执行。
按目录 ID 操作，目录及其祖先改名或移动后仍可删除，不要求名称或父目录匹配。
只接受目录 ID，不能删除媒体或效果模板。`,
  parameters: {
    type: 'object',
    properties: {
      dirId: {
        type: 'string',
        minLength: 1,
        description: '待删除的空文件夹的完整原始 ID，填入读取结果中的 dirId。',
      },
    },
    required: ['dirId'],
    additionalProperties: false,
  },
}
