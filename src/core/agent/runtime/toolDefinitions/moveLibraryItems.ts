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
返回每个项目移动前后状态、目标路径和历史记录描述。

Limitations
-----------
素材使用 mediaId 和 match.parentPath；文件夹使用完整路径和 match。不能移动根目录、移动到当前父目录、移动到自身/子目录，或同时移动存在父子关系的文件夹。`,
  parameters: {
    type: 'object',
    properties: {
      items: {
        type: 'array',
        minItems: 1,
        description: '要移动的素材库项目。每个项目必须提供最新 match 作为状态校验。',
        items: {
          oneOf: [
            {
              type: 'object',
              properties: {
                type: {
                  const: 'directory',
                },
                path: {
                  type: 'string',
                  description: '待移动文件夹的完整规范路径。',
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
                  description: '待移动素材的完整 mediaId。',
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
      },
      targetPath: {
        type: 'string',
        description: '目标文件夹的完整规范路径，例如 /整理后/。',
      },
    },
    required: ['items', 'targetPath'],
    additionalProperties: false,
  },
}
