import type { ModelTool } from '../../transport/AgentClient'

export const createFolderDefinition: ModelTool = {
  name: 'create_folder',
  description: `What It Does
-------------
在素材库指定目录下创建一个普通文件夹。操作会写入项目的撤销/重做历史。

Use When
---------
- 用户要求在某个素材库目录中新建文件夹

Do NOT Use When
---------------
- 用户要求导入素材、创建特殊资源或删除目录
- 目标目录路径不明确时；应先使用 list_media 或 ask_user

Returns
-------
返回创建前后状态、新文件夹路径和历史记录描述。

Limitations
-----------
parentPath 必须是以 / 开头的现有目录路径。文件夹名称遵循素材库现有命名规则，不能与同级文件夹重名。`,
  parameters: {
    type: 'object',
    properties: {
      parentPath: {
        type: 'string',
        description:
          '父目录的规范路径，例如 / 或 /素材/。必须是用户指定、被动上下文或 list_media 已确认的现有目录。',
      },
      name: {
        type: 'string',
        description: '新文件夹名称。不能是空白、.、..，且不能包含 / 或 \\\\。',
      },
    },
    required: ['parentPath', 'name'],
    additionalProperties: false,
  },
}
