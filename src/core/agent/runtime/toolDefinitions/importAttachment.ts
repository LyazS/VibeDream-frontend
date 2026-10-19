import type { ModelTool } from '../../transport/AgentClient'

export const importAttachmentDefinition: ModelTool = {
  name: 'import_attachment',
  description: `What It Does
-------------
把当前执行会话中用户发送的图片附件完整原图复制到素材库，等待解码及原图、.meta 持久化全部完成后返回新的 mediaId。

Use When
---------
- 用户要求把聊天图片加入素材库
- 用户要求将聊天图片用于剪辑：先导入，再将返回的完整 mediaId 交给 insert_clip

Do NOT Use When
---------------
- 用户仅要求查看、描述或讨论图片，无需导入
- 素材已经在素材库中，应直接使用已有 mediaId

Examples
--------
{ "attachmentId": "attachment_a", "targetDirectoryId": "dir_a" }

Returns
--------
{ "tool": "import_attachment", "attachmentId": "attachment_a", "mediaId": "media_a", "mediaType": "image", "width": 3840, "height": 2160 }
失败时返回 error 和 code；file_missing 表示本地原图缺失，有效云端地址不能替代原图。失败或取消不返回 mediaId。

Limitations
-----------
仅支持当前执行会话实际引用的用户图片附件。每次调用创建独立素材，重复调用不会复用上次结果。
本工具只导入素材库，不插入时间轴；导入成功后素材独立保留，删除会话或后续插入失败都不会删除该素材。`,
  parameters: {
    type: 'object',
    properties: {
      attachmentId: {
        type: 'string',
        minLength: 1,
        description: '当前会话用户图片身份说明中的完整 attachmentId。不能传 mediaId、路径或 URL。',
      },
      targetDirectoryId: {
        type: 'string',
        minLength: 1,
        description: '可选目标素材目录 ID，来自 list_media/create_folder；省略时导入根目录。',
      },
    },
    required: ['attachmentId'],
    additionalProperties: false,
  },
}
