import { useUnifiedStore } from '@/core/unifiedStore'
import type { ToolDefinition } from './types'
import { buildToolSuccess } from './utils/result'
import {
  LibraryToolError,
  buildLibraryToolFailure,
  getLatestHistoryDescription,
  resolveLibraryItem,
} from './libraryEditShared'

export async function executeDeleteEmptyFolder(args: Record<string, unknown>) {
  try {
    const item = resolveLibraryItem({
      type: 'directory',
      path: args.path,
      match: args.match,
    })
    const store = useUnifiedStore()
    if (!store.isDirectoryEmpty(item.displayItem.id)) {
      throw new LibraryToolError('directory_not_empty', '文件夹不为空，不能通过此工具删除。')
    }

    await store.deleteEmptyDirectoryWithHistory(item.displayItem.id)
    return buildToolSuccess('delete_empty_folder', {
      before: item.snapshot,
      after: null,
      historyDescription: getLatestHistoryDescription(),
    })
  } catch (error) {
    return buildLibraryToolFailure('delete_empty_folder', error)
  }
}

export const deleteEmptyFolderTool: ToolDefinition = {
  name: 'delete_empty_folder',
  execute: executeDeleteEmptyFolder,
} as ToolDefinition
