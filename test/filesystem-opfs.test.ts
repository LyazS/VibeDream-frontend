import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { OPFSAdapter } from '../src/core/filesystem/adapters/OPFSAdapter'
import { FileSystemAccessAdapter } from '../src/core/filesystem/adapters/FileSystemAccessAdapter'
import { createFileSystemAdapter } from '../src/core/filesystem/createFileSystemAdapter'
import { ErrorCode } from '../src/core/filesystem/errors/ErrorCodes'
import { MemoryDirectory } from './helpers/opfs'

let root: MemoryDirectory
let getDirectory: ReturnType<typeof vi.fn<() => Promise<MemoryDirectory>>>
let picker: ReturnType<typeof vi.fn>
let adapter: OPFSAdapter

async function workspace() {
  return (await root.getDirectoryHandle('lightcut-workspaces')).getDirectoryHandle('automation')
}

beforeEach(() => {
  root = new MemoryDirectory()
  getDirectory = vi.fn(async () => root)
  picker = vi.fn()
  vi.stubGlobal('isSecureContext', true)
  vi.stubGlobal('navigator', { storage: { getDirectory, persist: vi.fn() } })
  vi.stubGlobal('FileSystemFileHandle', { prototype: { createWritable: vi.fn() } })
  vi.stubGlobal('window', { showDirectoryPicker: picker, FileSystemDirectoryHandle: vi.fn() })
  adapter = new OPFSAdapter({ workspaceId: 'automation' })
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('OPFS workspace access', () => {
  it('lazily initializes once, reports transitions and never prompts or resets on forcePrompt', async () => {
    expect(getDirectory).not.toHaveBeenCalled()
    const [first, second] = await Promise.all([
      adapter.checkPermission(),
      adapter.checkPermission(),
    ])
    expect(first).toEqual({ hasAccess: true, accessChanged: true })
    expect(second).toEqual({ hasAccess: true, accessChanged: false })
    await adapter.writeFile('keep.txt', 'keep')
    expect(await adapter.checkPermission(true)).toEqual({ hasAccess: true, accessChanged: false })
    expect(await adapter.getWorkspaceInfo()).toEqual({
      name: 'automation',
      canChangeWorkspace: false,
    })
    expect(await adapter.readFile('keep.txt')).toBe('keep')
    expect(getDirectory).toHaveBeenCalledOnce()
    expect(picker).not.toHaveBeenCalled()
    expect(navigator.storage.persist).not.toHaveBeenCalled()
  })

  it('retries a failed initialization and preserves the original failure cause', async () => {
    const cause = new DOMException('Storage blocked', 'NotAllowedError')
    getDirectory.mockRejectedValueOnce(cause)
    await expect(adapter.checkPermission()).rejects.toMatchObject({
      code: ErrorCode.PERMISSION_DENIED,
      cause,
    })
    await expect(adapter.checkPermission()).resolves.toMatchObject({ accessChanged: true })
    expect(getDirectory).toHaveBeenCalledTimes(2)
  })

  it.each(['insecure', 'missing-storage', 'missing-writer'])(
    'rejects unsupported contexts: %s',
    async (scenario) => {
      if (scenario === 'insecure') vi.stubGlobal('isSecureContext', false)
      if (scenario === 'missing-storage') vi.stubGlobal('navigator', {})
      if (scenario === 'missing-writer') vi.stubGlobal('FileSystemFileHandle', undefined)
      expect(adapter.isSupported()).toBe(false)
      await expect(adapter.checkPermission()).rejects.toMatchObject({
        code: ErrorCode.NOT_SUPPORTED,
      })
      expect(getDirectory).not.toHaveBeenCalled()
    },
  )

  it('does not recreate a removed workspace through its cached handle', async () => {
    await adapter.writeFile('project.json', 'saved')
    const namespaces = await root.getDirectoryHandle('lightcut-workspaces')
    await namespaces.removeEntry('automation', { recursive: true })
    await expect(adapter.checkPermission()).rejects.toMatchObject({
      code: ErrorCode.OPERATION_FAILED,
      cause: { name: 'NotFoundError' },
    })
    expect(namespaces.children.size).toBe(0)
    await expect(adapter.getWorkspaceInfo()).rejects.toMatchObject({
      code: ErrorCode.OPERATION_FAILED,
    })
    expect(getDirectory).toHaveBeenCalledOnce()
  })

  it('keeps different workspace namespaces separate within the same origin', async () => {
    await adapter.writeFile('project.json', 'first workspace')
    const other = new OPFSAdapter({ workspaceId: 'other' })
    expect(await other.fileExists('project.json')).toBe(false)
    await other.writeFile('project.json', 'second workspace')
    expect(await adapter.readFile('project.json')).toBe('first workspace')
    expect(await other.readFile('project.json')).toBe('second workspace')
  })
})

describe('OPFS I/O contract', () => {
  it('normalizes paths, supports Unicode, truncates overwrites and preserves binary bytes', async () => {
    await adapter.writeFile('/projects//测试 工程/config.json/', 'long original')
    await adapter.writeFile('projects/测试 工程/config.json', 'x')
    expect(await adapter.readFile('projects/测试 工程/config.json')).toBe('x')
    const bytes = new Uint8Array([0, 1, 128, 255])
    await adapter.writeFile('projects/测试 工程/media.bin', new Blob([bytes]))
    expect(
      new Uint8Array(
        await (await adapter.readFileAsBlob('projects/测试 工程/media.bin')).arrayBuffer(),
      ),
    ).toEqual(bytes)
    expect(await adapter.listDirectory('/projects//测试 工程/')).toEqual([
      { name: 'config.json', kind: 'file', path: 'projects/测试 工程/config.json' },
      { name: 'media.bin', kind: 'file', path: 'projects/测试 工程/media.bin' },
    ])
    await adapter.createDirectory('.')
    expect(await adapter.directoryExists('/')).toBe(true)
    expect((await adapter.listDirectory('')).map((entry) => entry.name)).toEqual(['projects'])
  })

  it.each(['../escape', 'a/../b', 'a/./b', 'a\\b', 'a\0b', 'https://example.com/x', '/C:/x'])(
    'rejects invalid paths before accessing storage: %s',
    async (path) => {
      await expect(adapter.writeFile(path, 'bad')).rejects.toMatchObject({
        code: ErrorCode.INVALID_PATH,
      })
      await expect(adapter.listDirectory(path)).rejects.toMatchObject({
        code: ErrorCode.INVALID_PATH,
      })
      expect(getDirectory).not.toHaveBeenCalled()
    },
  )

  it.each(['', '.', '/', '///'])('protects the workspace root: %s', async (path) => {
    await expect(adapter.deleteDirectory(path, true)).rejects.toMatchObject({
      code: ErrorCode.INVALID_PATH,
    })
    await expect(adapter.deleteFile(path)).rejects.toMatchObject({ code: ErrorCode.INVALID_PATH })
    await expect(adapter.readFile(path)).rejects.toMatchObject({ code: ErrorCode.INVALID_PATH })
    expect(getDirectory).not.toHaveBeenCalled()
  })

  it('distinguishes missing files, parents, type conflicts and nonempty directories', async () => {
    await adapter.writeFile('folder/file.txt', 'data')
    expect(await adapter.fileExists('folder/missing')).toBe(false)
    await expect(adapter.fileExists('missing/file')).rejects.toMatchObject({
      code: ErrorCode.DIRECTORY_NOT_FOUND,
    })
    expect(await adapter.directoryExists('missing/nested')).toBe(false)
    await expect(adapter.fileExists('folder')).rejects.toMatchObject({
      code: ErrorCode.OPERATION_FAILED,
    })
    await expect(adapter.directoryExists('folder/file.txt')).rejects.toMatchObject({
      code: ErrorCode.OPERATION_FAILED,
    })
    await expect(adapter.deleteDirectory('folder')).rejects.toMatchObject({
      code: ErrorCode.DIRECTORY_NOT_EMPTY,
    })
    await expect(adapter.deleteFile('folder')).rejects.toMatchObject({
      code: ErrorCode.OPERATION_FAILED,
    })
    await expect(adapter.deleteDirectory('folder/file.txt', true)).rejects.toMatchObject({
      code: ErrorCode.OPERATION_FAILED,
    })
    expect(await adapter.readFile('folder/file.txt')).toBe('data')
    await adapter.deleteDirectory('folder', true)
    expect(await adapter.directoryExists('folder')).toBe(false)
  })

  it('preserves quota errors and restores the queue after a failed write', async () => {
    await adapter.writeFile('file', 'old')
    const file = await (await workspace()).getFileHandle('file')
    const cause = new DOMException('Disk full', 'QuotaExceededError')
    vi.spyOn(file, 'createWritable').mockRejectedValueOnce(cause)
    await expect(adapter.writeFile('file', 'failed')).rejects.toMatchObject({
      code: ErrorCode.OPERATION_FAILED,
      cause,
    })
    await adapter.writeFile('file', 'new')
    expect(await adapter.readFile('file')).toBe('new')
  })

  it.each(['write', 'close'] as const)(
    'aborts a failed %s without replacing its error with an abort failure',
    async (phase) => {
      await adapter.writeFile('file', 'old')
      const file = await (await workspace()).getFileHandle('file')
      const stream = await file.createWritable()
      const cause = new DOMException('Write failed', 'QuotaExceededError')
      vi.spyOn(stream, phase).mockRejectedValueOnce(cause)
      const abort = vi.spyOn(stream, 'abort').mockRejectedValueOnce(new Error('Already closed'))
      vi.spyOn(file, 'createWritable').mockResolvedValueOnce(stream)
      await expect(adapter.writeFile('file', 'failed')).rejects.toMatchObject({ cause })
      expect(abort).toHaveBeenCalledOnce()
      expect(await adapter.readFile('file')).toBe('old')
    },
  )

  it('waits for close and serializes writes and subsequent reads in invocation order', async () => {
    await adapter.writeFile('file', 'old')
    const file = await (await workspace()).getFileHandle('file')
    const stream = await file.createWritable()
    let release!: () => void
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    const close = stream.close.bind(stream)
    vi.spyOn(stream, 'close').mockImplementation(async () => {
      await gate
      await close()
    })
    vi.spyOn(file, 'createWritable').mockResolvedValueOnce(stream)
    let settled = false
    const first = adapter.writeFile('file', 'first').then(() => {
      settled = true
    })
    const second = adapter.writeFile('file', 'second')
    const read = adapter.readFile('file')
    await vi.waitFor(() => expect(stream.close).toHaveBeenCalledOnce())
    expect(settled).toBe(false)
    expect(await file.content.text()).toBe('old')
    release()
    await Promise.all([first, second])
    expect(await read).toBe('second')
  })

  it('copies and moves binary files, with same-path moves remaining harmless', async () => {
    await adapter.writeFile('source', new Blob([new Uint8Array([0, 255])]))
    await adapter.copyFile('source', 'copy')
    await adapter.moveFile('copy', 'nested/moved')
    expect(await adapter.fileExists('copy')).toBe(false)
    await adapter.moveFile('/nested//moved', 'nested/moved/')
    expect(
      new Uint8Array(await (await adapter.readFileAsBlob('nested/moved')).arrayBuffer()),
    ).toEqual(new Uint8Array([0, 255]))
    expect(await adapter.fileExists('source')).toBe(true)
  })

  it('retains the source if copying fails and retains both files if source deletion fails', async () => {
    await adapter.writeFile('source', 'original')
    await adapter.createDirectory('dest')
    await expect(adapter.moveFile('source', 'dest')).rejects.toMatchObject({
      code: ErrorCode.OPERATION_FAILED,
    })
    expect(await adapter.readFile('source')).toBe('original')
    const directory = await workspace()
    const cause = new DOMException('Delete blocked', 'NotAllowedError')
    vi.spyOn(directory, 'removeEntry').mockRejectedValueOnce(cause)
    await expect(adapter.moveFile('source', 'target')).rejects.toMatchObject({
      code: ErrorCode.PERMISSION_DENIED,
      cause,
    })
    expect(await adapter.readFile('source')).toBe('original')
    expect(await adapter.readFile('target')).toBe('original')
  })

  it('settles every batch write and exposes read subsets without hiding storage errors as missing', async () => {
    await expect(
      adapter.writeFiles(
        new Map([
          ['../bad', 'bad'],
          ['ok', 'saved'],
        ]),
      ),
    ).rejects.toMatchObject({ code: ErrorCode.INVALID_PATH })
    expect(await adapter.readFile('ok')).toBe('saved')
    const log = vi.spyOn(console, 'error').mockImplementation(() => {})
    expect(await adapter.readFiles(['missing', 'ok'])).toEqual(new Map([['ok', 'saved']]))
    expect(log).toHaveBeenCalledOnce()
    const directory = await workspace()
    vi.spyOn(directory, 'getFileHandle').mockRejectedValueOnce(
      new DOMException('Blocked', 'NotAllowedError'),
    )
    await expect(adapter.fileExists('ok')).rejects.toMatchObject({
      code: ErrorCode.PERMISSION_DENIED,
    })
  })
})

describe('storage configuration', () => {
  it('selects only the explicitly configured adapter and workspace', async () => {
    expect(
      createFileSystemAdapter({ VITE_FILE_SYSTEM_ADAPTER: 'file-system-access' }),
    ).toBeInstanceOf(FileSystemAccessAdapter)
    const configured = createFileSystemAdapter({
      VITE_FILE_SYSTEM_ADAPTER: 'opfs',
      VITE_OPFS_WORKSPACE_ID: 'configured-workspace',
    })
    expect(configured).toBeInstanceOf(OPFSAdapter)
    expect(getDirectory).not.toHaveBeenCalled()
    expect(await configured.getWorkspaceInfo()).toEqual({
      name: 'configured-workspace',
      canChangeWorkspace: false,
    })
  })

  it.each([undefined, ''])('rejects a missing or empty adapter setting: %s', (name) => {
    expect(() => createFileSystemAdapter({ VITE_FILE_SYSTEM_ADAPTER: name })).toThrow(
      '必须配置 VITE_FILE_SYSTEM_ADAPTER',
    )
  })

  it('requires an explicit workspace ID for OPFS', () => {
    expect(() => createFileSystemAdapter({ VITE_FILE_SYSTEM_ADAPTER: 'opfs' })).toThrow(
      '使用 OPFS 时必须配置 VITE_OPFS_WORKSPACE_ID',
    )
  })

  it.each(['../bad', '', '.', 'a/b', 'x'.repeat(81)])(
    'rejects invalid workspace IDs: %s',
    (workspaceId) => {
      expect(() =>
        createFileSystemAdapter({
          VITE_FILE_SYSTEM_ADAPTER: 'opfs',
          VITE_OPFS_WORKSPACE_ID: workspaceId,
        }),
      ).toThrowError(expect.objectContaining({ code: ErrorCode.INVALID_PATH }))
    },
  )

  it('rejects unknown adapter names without falling back', () => {
    expect(() => createFileSystemAdapter({ VITE_FILE_SYSTEM_ADAPTER: 'OPFS' })).toThrow(
      '未知文件系统适配器配置',
    )
  })
})
