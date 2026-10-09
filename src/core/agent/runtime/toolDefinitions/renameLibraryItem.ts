import type { ModelTool } from '../../transport/AgentClient'

export const renameLibraryItemDefinition: ModelTool = {
  name: 'rename_library_item',
  description: `What It Does
-------------
重命名一个素材库文件夹或素材。操作会写入项目的撤销/重做历史。

Use When
---------
- 用户要求修改已知文件夹或素材的名称

Do NOT Use When
---------------
- 需要移动项目，应使用 move_library_items
- 目标身份、当前名称或父目录不明确时；应先使用 list_media、被动上下文或 ask_user

Returns
-------
返回项目的 before、after 和历史记录描述。

Limitations
-----------
文件夹用完整路径定位；素材必须使用完整 mediaId 定位。match 是并发校验，当前状态不匹配时不会执行。`,
  parameters: {
    type: 'object',
    properties: {
      item: {
        oneOf: [
          {
            type: 'object',
            properties: {
              type: {
                const: 'directory',
              },
              path: {
                type: 'string',
                description: '待重命名文件夹的完整规范路径，例如 /素材/原始视频/。',
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
                    description:
                      '当前父目录的规范路径。必须与最近一次读取或被动上下文中的值完全一致。',
                  },
                },
                required: ['name', 'parentPath'],
                additionalProperties: false,
              },
            },
            required: ['type', 'path', 'match'],
            additionalProperties: false,
          },
          {
            type: 'object',
            properties: {
              type: {
                const: 'media',
              },
              mediaId: {
                type: 'string',
                description:
                  '待重命名素材的完整 mediaId，必须来自 list_media、read_media 或被动上下文。',
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
                    description:
                      '当前父目录的规范路径。必须与最近一次读取或被动上下文中的值完全一致。',
                  },
                },
                required: ['name', 'parentPath'],
                additionalProperties: false,
              },
            },
            required: ['type', 'mediaId', 'match'],
            additionalProperties: false,
          },
        ],
      },
      newName: {
        type: 'string',
        description: '新的非空名称。',
      },
    },
    required: ['item', 'newName'],
    additionalProperties: false,
  },
}
