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
- 路径或当前状态不明确时；应先使用 list_media 或 ask_user

Returns
-------
返回删除前快照、after: null 和历史记录描述。

Limitations
-----------
不能删除根目录。目录必须没有直属素材且没有子文件夹；match 不一致或目录变为非空时不会执行。`,
  parameters: {
    type: 'object',
    properties: {
      path: {
        type: 'string',
        description: '待删除空文件夹的完整规范路径。',
      },
      match: {
        type: 'object',
        properties: {
          name: {
            type: 'string',
            description: '当前名称。必须与最近一次读取或被动上下文中的值完全一致。',
          },
          parentPath: {
            type: 'string',
            description: '当前父目录的规范路径。必须与最近一次读取或被动上下文中的值完全一致。',
          },
        },
        required: ['name', 'parentPath'],
        additionalProperties: false,
      },
    },
    required: ['path', 'match'],
    additionalProperties: false,
  },
}
