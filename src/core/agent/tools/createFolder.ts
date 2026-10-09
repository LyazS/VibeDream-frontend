import { useUnifiedStore } from '@/core/unifiedStore'
import type { ToolDefinition } from './types'
import { buildToolSuccess } from './utils/result'
import {
  buildLibraryToolFailure,
  getLatestHistoryDescription,
  getLibraryItemSnapshot,
  requireNonEmptyString,
  resolveDirectoryByPath,
} from './libraryEditShared'

export async function executeCreateFolder(args: Record<string, unknown>) {
  try {
    const parent = resolveDirectoryByPath(args.parentPath)
    const name = requireNonEmptyString(args.name, 'name')
    const store = useUnifiedStore()
    const directory = await store.createDirectoryWithHistory(name, parent.directory.id)
    const after = getLibraryItemSnapshot({ id: directory.id, type: 'directory' })

    if (!after) {
      throw new Error('创建文件夹后无法读取结果。')
    }

    return buildToolSuccess('create_folder', {
      before: null,
      after,
      parentPath: parent.path,
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
