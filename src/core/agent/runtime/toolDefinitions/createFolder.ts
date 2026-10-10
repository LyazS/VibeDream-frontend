import type { ModelTool } from '../../transport/AgentClient'

export const createFolderDefinition: ModelTool = {
  name: 'create_folder',
  description: `What It Does
-------------
在素材库指定目录下创建一个普通文件夹，支持撤销和重做。

Use When
---------
- 用户要求在某个素材库目录中新建文件夹

Do NOT Use When
---------------
- 用户要求导入素材、创建特殊资源或删除目录
- 父目录 ID 不明确时；应先使用 list_media 或 ask_user

Returns
-------
{
  "tool": "create_folder",                  // 工具名
  "before": null,                           // 创建前不存在该项目
  "after": {
    "itemId": "<newDirId>",                 // 新文件夹的完整原始目录 ID
    "name": "<name>",                       // 创建后的名称
    "parentDirId": "<parentDirId>"          // 所属父目录 ID
  },
  "historyDescription": "<description>"    // 历史记录描述
}

{
  "tool": "create_folder",                  // 工具名
  "error": "<errorMessage>",                // 错误说明
  "code": "<errorCode>"                     // 错误码
}

after.itemId 可直接作为 list_media 的 dirId，继续浏览新文件夹。
父目录改名或移动后，parentDirId 仍指向同一个目录；ID 不存在时返回 directory_not_found。
名称非法返回 invalid_name，同级文件夹重名返回 duplicate_name，不自动编号或合并。

Examples
--------
{"parentDirId":"dir_videos","name":"精选"}

Limitations
-----------
一次只创建一个普通文件夹，不自动创建缺失的父目录。`,
  parameters: {
    type: 'object',
    properties: {
      parentDirId: {
        type: 'string',
        minLength: 1,
        description:
          '新文件夹所在的父目录 ID，必须使用 list_media、写工具结果或本轮工程上下文提供的完整原始目录 ID。',
      },
      name: {
        type: 'string',
        minLength: 1,
        description:
          '新文件夹名称，不能为空、. 或 ..，不能含斜杠、反斜杠或控制字符，且不能与同级文件夹同名。',
      },
    },
    required: ['parentDirId', 'name'],
    additionalProperties: false,
  },
}
