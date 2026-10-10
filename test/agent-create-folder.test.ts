import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createToolRuntime } from '../src/core/agent/runtime/ToolRuntime'
import { executeCreateFolder } from '../src/core/agent/tools/createFolder'
import { executeListMedia } from '../src/core/agent/tools/listMedia'
import { createUnifiedDirectoryModule } from '../src/core/modules/UnifiedDirectoryModule'
import { createUnifiedHistoryModule } from '../src/core/modules/UnifiedHistoryModule'
import { CreateDirectoryCommand } from '../src/core/modules/commands/LibraryCommands'
import { HistoryPreconditionError } from '../src/core/modules/commands/HistoryPreconditionError'
import { ModuleRegistry, MODULE_NAMES } from '../src/core/modules/ModuleRegistry'
import type { VirtualDirectory } from '../src/core/directory/types'

vi.mock('../src/core/managers/media/globalMetaFileManager', () => ({
  globalMetaFileManager: {},
}))
vi.mock('../src/core/composables/useI18n', () => ({
  useAppI18n: () => ({ t: (key: string) => key }),
}))
vi.mock('../src/core/unifiedStore', () => ({ useUnifiedStore: () => store }))
vi.mock('../src/core/agent/tools', () => ({
  executeTool: (name: string, args: Record<string, unknown>) =>
    name === 'create_folder' ? executeCreateFolder(args) : executeListMedia(args),
}))

let directories: ReturnType<typeof createUnifiedDirectoryModule>
let history: ReturnType<typeof createUnifiedHistoryModule>
let store: ReturnType<typeof createTestStore>
let rootId: string
let parentId: string

function createTestStore() {
  return {
    get directories() {
      return directories.directories.value
    },
    getDirectory: directories.getDirectory,
    getAssetIdsInDirectory: directories.getAssetIdsInDirectory,
    getAllAssets: () => [],
    getHistorySummary: history.getHistorySummary,
    createDirectoryWithHistory: vi.fn(async (name: string, parentDirId: string) => {
      const command = new CreateDirectoryCommand(name, parentDirId, directories)
      await history.executeCommand(command)
      const created = command.createdDirectory
      if (!created) throw new Error('Missing created directory')
      return created
    }),
  }
}

function createDirectory(name: string, parentDirId: string | null): VirtualDirectory {
  const result = directories.createDirectory(name, parentDirId)
  if (!result.success) throw new Error(result.error)
  return result.directory
}

async function call(name: string, args: Record<string, unknown>) {
  const result = await createToolRuntime().execute(
    { id: 'create1', name, args },
    {
      toolCallId: 'create1',
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

function create(args: Record<string, unknown>) {
  return call('create_folder', args)
}

beforeEach(() => {
  const registry = new ModuleRegistry()
  registry.register(MODULE_NAMES.MEDIA, { getAllAssets: () => [] })
  registry.register(MODULE_NAMES.USENAIVEUI, {
    messageError: vi.fn(),
    messageWarning: vi.fn(),
    messageSuccess: vi.fn(),
  })
  directories = createUnifiedDirectoryModule(registry)
  history = createUnifiedHistoryModule(registry)
  store = createTestStore()
  rootId = createDirectory('素材库', null).id
  parentId = createDirectory('视频', rootId).id
})

describe('create_folder ID contract', () => {
  it('creates in a listed parent, returns only the new state, and preserves ID through undo/redo', async () => {
    const parent = (await call('list_media', { dirId: parentId })).output
    const { result, output } = await create({ parentDirId: parent.dirId, name: '  精选  ' })
    const newId = output.after.itemId
    expect(result.success).toBe(true)
    expect(output).toEqual({
      tool: 'create_folder',
      before: null,
      after: { itemId: newId, name: '精选', parentDirId: parentId },
      historyDescription: expect.any(String),
    })
    expect(newId).toMatch(/^dir_/)
    expect(directories.getDirectory(parentId)!.childDirIds).toContain(newId)
    expect(history.getHistorySummary().totalCommands).toBe(1)
    expect((await call('list_media', { dirId: newId })).output).toMatchObject({
      dirId: newId,
      name: '精选',
      parentDirId: parentId,
      path: '/视频/精选/',
      entries: [],
    })

    expect(await history.undo()).toBe(true)
    expect(directories.getDirectory(newId)).toBeUndefined()
    expect(directories.getDirectory(parentId)!.childDirIds).not.toContain(newId)
    expect(await history.redo()).toBe(true)
    expect(directories.getDirectory(newId)).toMatchObject({
      id: newId,
      name: '精选',
      parentId,
    })
    expect(history.getHistorySummary().totalCommands).toBe(1)
  })

  it('allows creation directly in the root with its explicit ID', async () => {
    expect((await create({ parentDirId: rootId, name: '新建' })).output.after).toMatchObject({
      name: '新建',
      parentDirId: rootId,
    })
  })

  it.each([
    {},
    { name: '精选' },
    { parentDirId: 'dir_parent' },
    { parentPath: '/视频/', name: '精选' },
    { parentDirId: 'dir_parent', parentPath: '/视频/', name: '精选' },
    { parentDirId: '', name: '精选' },
    { parentDirId: null, name: '精选' },
    { parentDirId: 1, name: '精选' },
    { parentDirId: { id: 'dir_parent' }, name: '精选' },
    { parentDirId: 'dir_parent', name: '' },
    { parentDirId: 'dir_parent', name: 1 },
    { parentDirId: 'dir_parent', name: '精选', itemId: 'dir_custom' },
  ])('rejects legacy or malformed arguments via ToolRuntime: %j', async (args) => {
    await expect(create(args)).rejects.toThrow('TOOL_ARGUMENTS_INVALID')
    expect(store.createDirectoryWithHistory).not.toHaveBeenCalled()
    expect(history.getHistorySummary().totalCommands).toBe(0)
  })

  it('rejects blank IDs before executing a command', async () => {
    const { result, output } = await create({ parentDirId: '   ', name: '精选' })
    expect(result.success).toBe(false)
    expect(output.code).toBe('invalid_arguments')
    expect(store.createDirectoryWithHistory).not.toHaveBeenCalled()
  })

  it('never substitutes paths, names, shortened or whitespace-modified IDs', async () => {
    for (const parentDirId of ['/视频/', '视频', parentId.slice(0, -1), ` ${parentId} `]) {
      const { result, output } = await create({ parentDirId, name: '精选' })
      expect(result.success).toBe(false)
      expect(output.code).toBe('directory_not_found')
    }
    expect(store.createDirectoryWithHistory).not.toHaveBeenCalled()
  })

  it('keeps targeting the same parent after it is renamed and moved', async () => {
    const target = createDirectory('目标', rootId)
    expect(directories.renameDirectory(parentId, '重命名').success).toBe(true)
    expect(directories.moveDirectoryToParent(parentId, target.id).success).toBe(true)
    const { output } = await create({ parentDirId: parentId, name: '精选' })
    expect(output.after.parentDirId).toBe(parentId)
    expect((await call('list_media', { dirId: output.after.itemId })).output.path).toBe(
      '/目标/重命名/精选/',
    )
  })

  it('uses the specified parent among historical same-name folders', async () => {
    const other = createDirectory('其他', rootId)
    directories.getDirectory(other.id)!.name = '视频'
    const { output } = await create({ parentDirId: other.id, name: '精选' })
    expect(output.after.parentDirId).toBe(other.id)
    expect(directories.getDirectory(parentId)!.childDirIds).toEqual([])
  })

  it('does not replace a deleted parent with a newly created same-name folder', async () => {
    expect(directories.removeEmptyDirectory(parentId).success).toBe(true)
    const replacement = createDirectory('视频', rootId)
    expect((await create({ parentDirId: parentId, name: '精选' })).output.code).toBe(
      'directory_not_found',
    )
    expect(replacement.childDirIds).toEqual([])
    expect(store.createDirectoryWithHistory).not.toHaveBeenCalled()
  })

  it.each(['   ', '.', '..', 'a/b', 'a\\b', 'a\u0000b', 'a\nb', 'a\u007fb'])(
    'preserves invalid_name from the real history command for %j',
    async (name) => {
      const { result, output } = await create({ parentDirId: parentId, name })
      expect(result.success).toBe(false)
      expect(output.code).toBe('invalid_name')
      expect(directories.getDirectory(parentId)!.childDirIds).toEqual([])
      expect(history.getHistorySummary().totalCommands).toBe(0)
    },
  )

  it('reports same-parent duplicates and allows the same name in another parent', async () => {
    createDirectory('精选', parentId)
    const { result, output } = await create({ parentDirId: parentId, name: ' 精选 ' })
    expect(result.success).toBe(false)
    expect(output.code).toBe('duplicate_name')
    expect(history.getHistorySummary().totalCommands).toBe(0)
    expect((await create({ parentDirId: rootId, name: '精选' })).result.success).toBe(true)
    expect((await create({ parentDirId: parentId, name: 'selected' })).result.success).toBe(true)
    expect((await create({ parentDirId: parentId, name: 'Selected' })).result.success).toBe(true)
  })

  it('reports parent deletion at command execution without adding history', async () => {
    store.createDirectoryWithHistory.mockImplementationOnce(async (name, parentDirId) => {
      directories.removeEmptyDirectory(parentDirId)
      const command = new CreateDirectoryCommand(name, parentDirId, directories)
      await history.executeCommand(command)
      throw new Error('Unreachable')
    })
    expect((await create({ parentDirId: parentId, name: '精选' })).output.code).toBe(
      'directory_not_found',
    )
    expect(history.getHistorySummary().totalCommands).toBe(0)
  })

  it('keeps history precondition errors distinguishable for UI handling', async () => {
    const command = new CreateDirectoryCommand('.', parentId, directories)
    await expect(command.execute()).rejects.toBeInstanceOf(HistoryPreconditionError)
  })

  it('refuses redo if a same-name folder has appeared after undo', async () => {
    const { output } = await create({ parentDirId: parentId, name: '精选' })
    expect(await history.undo()).toBe(true)
    const replacement = createDirectory('精选', parentId)
    expect(await history.redo()).toBe(false)
    expect(directories.getDirectory(output.after.itemId)).toBeUndefined()
    expect(directories.getDirectory(parentId)!.childDirIds).toEqual([replacement.id])
  })
})
