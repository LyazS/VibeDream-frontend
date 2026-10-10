import { useUnifiedStore } from '@/core/unifiedStore'
import type { ToolDefinition } from './types'
import { buildToolSuccess } from './utils/result'
import {
  LibraryToolError,
  buildLibraryToolFailure,
  getDirectoryAncestorIds,
} from './libraryEditShared'

export async function executeDeleteEmptyFolder(args: Record<string, unknown>) {
  try {
    const dirId = args.dirId
    if (typeof dirId !== 'string' || !dirId.trim()) {
      throw new LibraryToolError('invalid_arguments', 'dirId 必须是非空字符串。')
    }
    const store = useUnifiedStore()
    const directory = store.getDirectory(dirId)
    if (!directory) {
      throw new LibraryToolError('directory_not_found', '未找到目录：' + dirId)
    }
    if (directory.parentId === null) {
      throw new LibraryToolError('root_directory_protected', '不能删除根目录。')
    }
    const parentDirId = directory.parentId
    if (
      typeof parentDirId !== 'string' ||
      !parentDirId.trim() ||
      !store.getDirectory(parentDirId)
    ) {
      throw new LibraryToolError('invalid_location', '目录没有有效的直接父目录。')
    }
    getDirectoryAncestorIds(dirId)
    if (!store.getDirectory(parentDirId)!.childDirIds.includes(dirId)) {
      throw new LibraryToolError('invalid_directory_structure', '目录未登记在其父目录中。')
    }
    if (!store.isDirectoryEmpty(dirId)) {
      throw new LibraryToolError('directory_not_empty', '文件夹不为空，不能通过此工具删除。')
    }

    await store.deleteEmptyDirectoryWithHistory(dirId)
    return buildToolSuccess('delete_empty_folder', {
      after: null,
    })
  } catch (error) {
    return buildLibraryToolFailure('delete_empty_folder', error)
  }
}

export const deleteEmptyFolderTool: ToolDefinition = {
  name: 'delete_empty_folder',
  execute: executeDeleteEmptyFolder,
} as ToolDefinition
