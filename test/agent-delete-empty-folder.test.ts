import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createToolRuntime } from '../src/core/agent/runtime/ToolRuntime'
import { executeDeleteEmptyFolder } from '../src/core/agent/tools/deleteEmptyFolder'
import { executeListMedia } from '../src/core/agent/tools/listMedia'
import { createUnifiedDirectoryModule } from '../src/core/modules/UnifiedDirectoryModule'
import { createUnifiedHistoryModule } from '../src/core/modules/UnifiedHistoryModule'
import { DeleteEmptyDirectoryCommand } from '../src/core/modules/commands/LibraryCommands'
import { ModuleRegistry, MODULE_NAMES } from '../src/core/modules/ModuleRegistry'
import { createUnifiedMediaItemData } from '../src/core/mediaitem/types'
import { UserSelectedFileSourceFactory } from '../src/core/datasource/providers/user-selected/UserSelectedFileSource'
import {
  createTransitionTemplateAssetData,
  isMediaAsset,
  type UnifiedLibraryAssetData,
} from '../src/core/asset/types'

vi.mock('../src/core/managers/media/globalMetaFileManager', () => ({ globalMetaFileManager: {} }))
vi.mock('../src/core/composables/useI18n', () => ({
  useAppI18n: () => ({ t: (key: string) => key }),
}))
vi.mock('../src/core/unifiedStore', () => ({ useUnifiedStore: () => store }))
vi.mock('../src/core/agent/tools', () => ({
  executeTool: (name: string, args: Record<string, unknown>) =>
    name === 'delete_empty_folder' ? executeDeleteEmptyFolder(args) : executeListMedia(args),
}))

let directories: ReturnType<typeof createUnifiedDirectoryModule>
let history: ReturnType<typeof createUnifiedHistoryModule>
let store: ReturnType<typeof createTestStore>
let assets: Map<string, UnifiedLibraryAssetData>
let rootId: string
let parentId: string
let folderId: string

function createTestStore() {
  return {
    get directories() {
      return directories.directories.value
    },
    getDirectory: directories.getDirectory,
    getAllAssets: () => [...assets.values()],
    getAssetIdsInDirectory: directories.getAssetIdsInDirectory,
    isDirectoryEmpty: directories.isDirectoryEmpty,
    deleteEmptyDirectoryWithHistory: vi.fn(async (dirId: string) => {
      await history.executeCommand(new DeleteEmptyDirectoryCommand(dirId, directories))
    }),
  }
}

function folder(name: string, parent: string | null = parentId) {
  const result = directories.createDirectory(name, parent)
  if (!result.success) throw new Error(result.error)
  return result.directory
}

function addMedia(parent = folderId, register = true) {
  const source = UserSelectedFileSourceFactory.createFromBaseData({ type: 'user-selected' })
  const asset = createUnifiedMediaItemData('media_take01', '镜头01.mp4', source, {
    parentDirectoryId: parent,
    mediaType: 'video',
  })
  assets.set(asset.id, asset)
  if (register) expect(directories.registerAssetLocation(asset.id).success).toBe(true)
  return asset
}

function request(dirId = folderId) {
  return { dirId }
}

async function call(name: string, args: Record<string, unknown>) {
  const result = await createToolRuntime().execute(
    { id: 'delete1', name, args },
    {
      toolCallId: 'delete1',
      userId: 'u1',
      projectId: 'p1',
      sessionId: 's1',
      modelCallId: 't1',
      signal: new AbortController().signal,
      isCurrent: () => true,
    },
  )
  return { result, output: JSON.parse(result.output) }
}

function remove(args: Record<string, unknown> = request()) {
  return call('delete_empty_folder', args)
}

function expectNoDeletion() {
  expect(store.deleteEmptyDirectoryWithHistory).not.toHaveBeenCalled()
  expect(directories.getDirectory(folderId)).toBeDefined()
  expect(history.getHistorySummary().totalCommands).toBe(0)
}

beforeEach(() => {
  assets = new Map()
  const registry = new ModuleRegistry()
  registry.register(MODULE_NAMES.MEDIA, {
    getAllAssets: () => [...assets.values()],
    getMediaAsset: (id: string) => {
      const asset = assets.get(id)
      return isMediaAsset(asset) ? asset : undefined
    },
  })
  registry.register(MODULE_NAMES.USENAIVEUI, {
    messageError: vi.fn(),
    messageWarning: vi.fn(),
    messageSuccess: vi.fn(),
  })
  directories = createUnifiedDirectoryModule(registry)
  history = createUnifiedHistoryModule(registry)
  store = createTestStore()
  rootId = folder('素材库', null).id
  parentId = folder('视频', rootId).id
  folderId = folder('待整理').id
})

describe('delete_empty_folder ID contract', () => {
  it('deletes a listed empty folder with a minimal result and one undo entry', async () => {
    const listing = (await call('list_media', { dirId: parentId })).output
    const entry = listing.entries.find((value: { dirId: string }) => value.dirId === folderId)
    const original = { ...directories.getDirectory(folderId)!, childDirIds: [] }
    const { result, output } = await remove({
      dirId: entry.dirId,
    })
    expect(result.success).toBe(true)
    expect(output).toEqual({ tool: 'delete_empty_folder', after: null })
    expect(store.deleteEmptyDirectoryWithHistory).toHaveBeenCalledWith(folderId)
    expect(directories.getDirectory(folderId)).toBeUndefined()
    expect(directories.getDirectory(parentId)!.childDirIds).not.toContain(folderId)
    expect(history.getHistorySummary().totalCommands).toBe(1)
    expect(await history.undo()).toBe(true)
    expect(directories.getDirectory(folderId)).toEqual(original)
    expect(await history.redo()).toBe(true)
    expect(directories.getDirectory(folderId)).toBeUndefined()
    expect(history.getHistorySummary().totalCommands).toBe(1)
  })

  it('restores the original sibling position and metadata on undo', async () => {
    const first = folder('第一个').id
    const middle = folder('中间').id
    folder('最后一个')
    const directory = directories.getDirectory(middle)!
    directory.metadata = { custom: 'retained' }
    const original = [...directories.getDirectory(parentId)!.childDirIds]
    expect((await remove(request(middle))).result.success).toBe(true)
    expect(await history.undo()).toBe(true)
    expect(directories.getDirectory(parentId)!.childDirIds).toEqual(original)
    expect(directories.getDirectory(middle)!.metadata).toEqual({ custom: 'retained' })
    expect(directories.getDirectory(first)).toBeDefined()
  })

  it.each([
    {},
    { path: '/视频/待整理/', match: { name: '待整理', parentPath: '/视频/' } },
    { dirId: '' },
    { dirId: null },
    { dirId: 123 },
    { dirId: [] },
    { dirId: 'dir_x', match: '{}' },
    { dirId: 'dir_x', match: { name: '待整理' } },
    { dirId: 'dir_x', match: { name: '', parentDirId: 'dir_parent' } },
    { dirId: 'dir_x', match: { name: '待整理', parentDirId: null } },
    { dirId: 'dir_x', match: { name: '待整理', parentDirId: '' } },
    { dirId: 'dir_x', match: { name: '待整理', parentPath: '/视频/' } },
    { dirId: 'dir_x', match: { name: '待整理', parentDirId: 'dir_parent', type: 'directory' } },
  ])('rejects legacy and malformed schema: %j', async (args) => {
    await expect(remove(args)).rejects.toThrow('TOOL_ARGUMENTS_INVALID')
    expectNoDeletion()
  })

  it.each(['itemId', 'type', 'path', 'mediaId', 'name', 'parentDirId', 'match'])(
    'rejects an extra top-level %s field',
    async (field) => {
      await expect(remove({ ...request(), [field]: 'extra' })).rejects.toThrow(
        'TOOL_ARGUMENTS_INVALID',
      )
      expectNoDeletion()
    },
  )

  it.each(['   ', '/视频/待整理/', '待整理', 'dir_missing'])(
    'does not fall back for an invalid directory ID %j',
    async (dirId) => {
      expect((await remove({ ...request(), dirId })).output.code).toBe(
        dirId.trim() ? 'directory_not_found' : 'invalid_arguments',
      )
      expectNoDeletion()
    },
  )

  it('does not trim, shorten or complete directory IDs', async () => {
    for (const dirId of [` ${folderId} `, folderId.slice(0, -1)]) {
      expect((await remove({ ...request(), dirId })).output.code).toBe('directory_not_found')
    }
    expectNoDeletion()
  })

  it('protects the root before checking emptiness', async () => {
    expect((await remove({ dirId: rootId })).output.code).toBe('root_directory_protected')
    expectNoDeletion()
  })

  it('only resolves directories even when an asset has the supplied ID', async () => {
    const asset = addMedia(parentId)
    const effect = createTransitionTemplateAssetData('effect', '转场', null)
    assets.set(effect.id, effect)
    for (const dirId of [asset.id, effect.id]) {
      expect((await remove({ ...request(), dirId })).output.code).toBe('directory_not_found')
      expect(assets.has(dirId)).toBe(true)
    }
    expectNoDeletion()
  })

  it('routes a directory by its actual record rather than the ID prefix', async () => {
    const directory = directories.getDirectory(folderId)!
    directories.directories.value.delete(folderId)
    directory.id = 'opaque-folder'
    directories.directories.value.set(directory.id, directory)
    directories.getDirectory(parentId)!.childDirIds[0] = directory.id
    expect((await remove(request(directory.id))).result.success).toBe(true)
    expect(directories.getDirectory(directory.id)).toBeUndefined()
  })

  it('selects an exact ID among historical same-name sibling directories', async () => {
    const original = directories.getDirectory(folderId)!
    directories.directories.value.set('historical_duplicate', {
      ...original,
      id: 'historical_duplicate',
      childDirIds: [],
    })
    directories.getDirectory(parentId)!.childDirIds.push('historical_duplicate')
    expect((await remove(request('historical_duplicate'))).result.success).toBe(true)
    expect(directories.getDirectory(folderId)).toBeDefined()
  })

  it('does not substitute a newly created same-name folder for a deleted ID', async () => {
    const args = request()
    directories.removeEmptyDirectory(folderId)
    const replacement = folder('待整理')
    expect((await remove(args)).output.code).toBe('directory_not_found')
    expect(directories.getDirectory(replacement.id)).toBeDefined()
    expect(store.deleteEmptyDirectoryWithHistory).not.toHaveBeenCalled()
  })

  it('allows ancestor renames and moves without changing the directory ID', async () => {
    const args = request()
    const container = folder('容器', rootId).id
    directories.renameDirectory(parentId, '改名视频')
    directories.moveDirectoryToParent(parentId, container)
    expect((await remove(args)).result.success).toBe(true)
    expect(await history.undo()).toBe(true)
    expect(directories.getDirectory(folderId)!.parentId).toBe(parentId)
  })

  it.each(['rename', 'move', 'rename-and-move'])(
    'deletes the same directory after %s since reading',
    async (change) => {
      const args = request()
      if (change.includes('rename')) directories.renameDirectory(folderId, '用户改名')
      if (change.includes('move')) directories.moveDirectoryToParent(folderId, rootId)
      const current = { ...directories.getDirectory(folderId)!, childDirIds: [] }
      expect((await remove(args)).result.success).toBe(true)
      expect(directories.getDirectory(folderId)).toBeUndefined()
      expect(await history.undo()).toBe(true)
      expect(directories.getDirectory(folderId)).toEqual(current)
    },
  )

  it.each(['child', 'unlisted-child', 'media', 'unindexed-media'])(
    'refuses a nonempty directory containing %s',
    async (kind) => {
      if (kind === 'child' || kind === 'unlisted-child') {
        folder('子目录', folderId)
        if (kind === 'unlisted-child') directories.getDirectory(folderId)!.childDirIds = []
      } else addMedia(folderId, kind === 'media')
      expect((await remove()).output.code).toBe('directory_not_empty')
      expectNoDeletion()
      if (kind.includes('media')) expect(assets.size).toBe(1)
    },
  )

  it.each(['missing-parent', 'cycle', 'missing-ancestor', 'missing-index'])(
    'rejects damaged directory structure: %s',
    async (kind) => {
      const args = request()
      if (kind === 'missing-parent') directories.getDirectory(folderId)!.parentId = 'missing'
      if (kind === 'cycle') directories.getDirectory(parentId)!.parentId = folderId
      if (kind === 'missing-ancestor') directories.getDirectory(parentId)!.parentId = 'missing'
      if (kind === 'missing-index') directories.getDirectory(parentId)!.childDirIds = []
      expect((await remove(args)).output.code).toBe(
        kind === 'missing-parent' ? 'invalid_location' : 'invalid_directory_structure',
      )
      expectNoDeletion()
    },
  )

  it('keeps the last tab open at the parent when its directory is deleted', async () => {
    const tab = directories.openTab(folderId, true)
    expect((await remove()).result.success).toBe(true)
    expect(directories.openTabs.value).toEqual([{ id: tab.id, dirId: parentId }])
  })
})

describe('delete_empty_folder command guards', () => {
  it('rechecks emptiness immediately before executing the delete command', async () => {
    store.deleteEmptyDirectoryWithHistory.mockImplementationOnce(async (dirId) => {
      addMedia()
      await history.executeCommand(new DeleteEmptyDirectoryCommand(dirId, directories))
    })
    expect((await remove()).output.code).toBe('directory_not_empty')
    expect(directories.getDirectory(folderId)).toBeDefined()
    expect(assets.size).toBe(1)
    expect(history.getHistorySummary().totalCommands).toBe(0)
  })

  it('preserves missing-directory errors from the command', async () => {
    store.deleteEmptyDirectoryWithHistory.mockImplementationOnce(async (dirId) => {
      directories.removeEmptyDirectory(dirId)
      await history.executeCommand(new DeleteEmptyDirectoryCommand(dirId, directories))
    })
    expect((await remove()).output.code).toBe('directory_not_found')
    expect(history.getHistorySummary().totalCommands).toBe(0)
  })

  it('refuses redo after the restored folder gains media', async () => {
    expect((await remove()).result.success).toBe(true)
    expect(await history.undo()).toBe(true)
    addMedia()
    expect(await history.redo()).toBe(false)
    expect(directories.getDirectory(folderId)).toBeDefined()
    expect(assets.size).toBe(1)
  })

  it.each(['name', 'parent'])('refuses redo after the restored folder changes %s', async (kind) => {
    expect((await remove()).result.success).toBe(true)
    expect(await history.undo()).toBe(true)
    if (kind === 'name') directories.renameDirectory(folderId, '用户改名')
    else directories.moveDirectoryToParent(folderId, rootId)
    expect(await history.redo()).toBe(false)
    expect(directories.getDirectory(folderId)).toBeDefined()
  })

  it('refuses undo if the source name has been occupied', async () => {
    expect((await remove()).result.success).toBe(true)
    const replacement = folder('待整理')
    expect(await history.undo()).toBe(false)
    expect(directories.getDirectory(folderId)).toBeUndefined()
    expect(directories.getDirectory(replacement.id)).toBeDefined()
  })

  it('refuses undo when the original parent no longer exists', async () => {
    expect((await remove()).result.success).toBe(true)
    expect(directories.removeEmptyDirectory(parentId).success).toBe(true)
    expect(await history.undo()).toBe(false)
    expect(directories.getDirectory(folderId)).toBeUndefined()
  })

  it('protects roots and broken parent indexes in the shared directory module', () => {
    expect(directories.removeEmptyDirectory(rootId)).toMatchObject({
      success: false,
      code: 'root_directory_protected',
    })
    directories.getDirectory(parentId)!.childDirIds = []
    expect(directories.removeEmptyDirectory(folderId)).toMatchObject({
      success: false,
      code: 'invalid_directory_structure',
    })
    expect(directories.getDirectory(folderId)).toBeDefined()
  })
})
