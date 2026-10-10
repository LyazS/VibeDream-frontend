import { useUnifiedStore } from '@/core/unifiedStore'
import type { ToolDefinition } from './types'
import { buildToolSuccess } from './utils/result'
import {
  buildLibraryToolFailure,
  getLatestHistoryDescription,
  LibraryToolError,
} from './libraryEditShared'

export async function executeCreateFolder(args: Record<string, unknown>) {
  try {
    const parentDirId = args.parentDirId
    if (typeof parentDirId !== 'string' || !parentDirId.trim()) {
      throw new LibraryToolError('invalid_arguments', 'parentDirId 必须是非空字符串。')
    }
    const store = useUnifiedStore()
    if (!store.getDirectory(parentDirId)) {
      throw new LibraryToolError('directory_not_found', `未找到父目录 ${parentDirId}。`)
    }

    const name = args.name
    if (typeof name !== 'string') {
      throw new LibraryToolError('invalid_arguments', 'name 必须是字符串。')
    }
    const directory = await store.createDirectoryWithHistory(name, parentDirId)

    return buildToolSuccess('create_folder', {
      before: null,
      after: {
        itemId: directory.id,
        name: directory.name,
        parentDirId: directory.parentId,
      },
      historyDescription: getLatestHistoryDescription(),
    })
  } catch (error) {
    return buildLibraryToolFailure('create_folder', error)
  }
}

export const createFolderTool: ToolDefinition = {
  name: 'create_folder',
  execute: executeCreateFolder,
} as ToolDefinition
