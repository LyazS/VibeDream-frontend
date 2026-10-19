import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fileSystemService } from '@/core/managers/filesystem/fileSystemService'
import { globalMetaFileManager } from '@/core/managers/media/globalMetaFileManager'
import { MediaItemLoader } from '@/core/managers/media/MediaItemLoader'
import { createUnifiedMediaItemData } from '@/core/mediaitem/types'
import { UserSelectedFileSourceFactory } from '@/core/datasource/providers/user-selected/UserSelectedFileSource'
import { UserSelectedFileProcessor } from '@/core/datasource/providers/user-selected/UserSelectedFileProcessor'
import { createTransitionTemplateAssetData, isMediaAsset } from '@/core/asset/types'
import { EffectPackageRegistry } from '@/core/effect-package/EffectPackageRegistry'
import { generateMediaId } from '@/core/utils/idGenerator'
import { extractExtension, getMediaFileName } from '@/core/utils/mediaPathUtils'

const memory = vi.hoisted(() => ({
  files: new Map<string, string | Blob>(),
  directories: new Set<string>(),
}))

vi.mock('@/core/managers/filesystem/fileSystemService', async () => {
  const { PathResolver } = await import('@/core/filesystem/core/PathResolver')
  const paths = new PathResolver()
  const read = (path: string) => {
    const content = memory.files.get(path)
    if (content === undefined) throw new Error(`File not found: ${path}`)
    return content
  }
  return {
    fileSystemService: {
      paths,
      checkPermission: vi.fn(async () => ({ hasAccess: true })),
      directoryExists: vi.fn(async (path: string) => memory.directories.has(path)),
      createDirectory: vi.fn(async (path: string) => {
        memory.directories.add(path)
      }),
      writeFile: vi.fn(async (path: string, content: string | Blob) => {
        memory.files.set(path, content)
      }),
      readFile: vi.fn(async (path: string) => {
        const content = read(path)
        return typeof content === 'string' ? content : content.text()
      }),
      readFileAsBlob: vi.fn(async (path: string) => {
        const content = read(path)
        return typeof content === 'string' ? new Blob([content]) : content
      }),
      fileExists: vi.fn(async (path: string) => memory.files.has(path)),
      deleteFile: vi.fn(async (path: string) => {
        memory.files.delete(path)
      }),
      listDirectory: vi.fn(async (path: string) => [
        ...Array.from(memory.files.keys())
          .filter((entry) => paths.dirname(entry) === path)
          .map((entry) => ({ path: entry, name: paths.basename(entry), kind: 'file' })),
        ...Array.from(memory.directories)
          .filter((entry) => paths.dirname(entry) === path)
          .map((entry) => ({ path: entry, name: paths.basename(entry), kind: 'directory' })),
      ]),
      deleteDirectory: vi.fn(async (path: string) => {
        for (const entry of memory.files.keys()) {
          if (entry.startsWith(`${path}/`)) memory.files.delete(entry)
        }
        for (const entry of memory.directories) {
          if (entry === path || entry.startsWith(`${path}/`)) memory.directories.delete(entry)
        }
      }),
    },
  }
})

beforeEach(async () => {
  vi.clearAllMocks()
  memory.files.clear()
  memory.directories.clear()
  await globalMetaFileManager.initialize('project')
})

describe('media file identity persistence', () => {
  it.each([
    ['clip.MP4', '.mp4'],
    ['camera.take.MOV', '.mov'],
    ['clip', ''],
    ['clip.', ''],
  ])('imports, renames, reloads and deletes %s using a separate extension', async (name, ext) => {
    const file = new File(['original media bytes'], name, { type: 'video/mp4' })
    const item = createUnifiedMediaItemData(
      generateMediaId(),
      name,
      UserSelectedFileSourceFactory.createFromFile(file),
      { ext: extractExtension(file.name), parentDirectoryId: 'dir_root', mediaType: 'video' },
    )
    expect(item.id).toMatch(/^media_[\w-]{12}$/)
    expect(item.ext).toBe(ext)
    const fileName = `${item.id}${ext}`
    const filePath = `projects/project/media/${fileName}`
    const metaPath = `projects/project/media/${item.id}.meta`

    await expect(globalMetaFileManager.saveMediaToProject(item, file)).resolves.toMatchObject({
      success: true,
      mediaId: item.id,
      storagePath: `media/${fileName}`,
    })
    expect([...memory.files.keys()]).toEqual([filePath, metaPath])

    item.name = 'Renamed display.wav'
    await expect(globalMetaFileManager.saveMetaFile(item)).resolves.toBe(true)
    const meta = JSON.parse(await fileSystemService.readFile(metaPath))
    expect(meta).toMatchObject({ version: '2.0.0', id: item.id, ext, name: item.name })
    expect(meta).not.toHaveProperty('storagePath')

    const [restored] = await new MediaItemLoader().loadMediaItemsFromMeta('project')
    if (!isMediaAsset(restored)) throw new Error('Expected a restored media asset')
    expect(restored).toMatchObject({
      id: item.id,
      ext,
      name: item.name,
      parentDirectoryId: 'dir_root',
    })
    await expect(globalMetaFileManager.verifyMediaFileExists(restored)).resolves.toBe(true)
    const prepared = await UserSelectedFileProcessor.getInstance().prepareMediaFileForDag(restored)
    expect(prepared.file.name).toBe(fileName)
    expect(prepared.file.type).toBe('video/mp4')
    expect(await prepared.file.text()).toBe('original media bytes')
    expect(getMediaFileName(restored)).toBe(fileName)

    await expect(globalMetaFileManager.deleteAssetFiles(restored)).resolves.toEqual({
      success: true,
      deletedMedia: true,
      deletedMeta: true,
    })
    expect(memory.files.size).toBe(0)
  })

  it('reports a media deletion failure instead of allowing the caller to drop the asset', async () => {
    const media = { id: 'media_clip', ext: '.mp4' }
    memory.files.set('projects/project/media/media_clip.mp4', new Blob(['video']))
    vi.mocked(fileSystemService.deleteFile).mockRejectedValueOnce(new Error('Write denied'))

    await expect(globalMetaFileManager.deleteMediaFiles(media)).resolves.toMatchObject({
      success: false,
      deletedMedia: false,
      error: expect.any(String),
    })
    expect(memory.files.has('projects/project/media/media_clip.mp4')).toBe(true)
  })

  it('saves the original and meta to the same captured project across initialization changes', async () => {
    const file = new File(['original'], 'image.png', { type: 'image/png' })
    const item = createUnifiedMediaItemData(
      'media_image',
      file.name,
      UserSelectedFileSourceFactory.createFromFile(file),
      { ext: '.png', parentDirectoryId: 'dir_root' },
    )
    vi.mocked(fileSystemService.writeFile).mockImplementationOnce(async (path, data) => {
      memory.files.set(path, data as Blob)
      await globalMetaFileManager.initialize('next-project')
    })
    expect((await globalMetaFileManager.saveMediaToProject(item, file)).success).toBe(true)
    expect([...memory.files.keys()]).toEqual([
      'projects/project/media/media_image.png',
      'projects/project/media/media_image.meta',
    ])
  })
})

describe('effect package paths', () => {
  const packageFiles = [
    {
      path: 'manifest.json',
      encoding: 'utf-8' as const,
      content: JSON.stringify({
        apiVersion: '1.0',
        packageId: 'fade',
        version: '1.0.0',
        effectType: 'transition',
        entry: 'index.js',
        name: 'Fade',
        host: { transition: { defaultDurationFrames: 12 } },
      }),
    },
    { path: 'index.js', encoding: 'utf-8' as const, content: 'export default {}' },
  ]

  it('installs and cleans up an effect directory without requiring a media extension', async () => {
    const registry = new EffectPackageRegistry()
    const installed = await registry.installDownloadedPackage(
      'project',
      'effect_fade',
      packageFiles,
    )
    expect(installed.name).toBe('Fade')
    expect(installed.templatePayload.packageDir).toBe('projects/project/media/effect_fade')
    expect(memory.files.has('projects/project/media/effect_fade/index.js')).toBe(true)

    await registry.cleanupInstalledPackage('project', 'effect_fade')
    expect(registry.getPackage('effect_fade')).toBeNull()
    expect(memory.files.size).toBe(0)
  })

  it('deletes effect files and their meta using the directory path', async () => {
    const asset = createTransitionTemplateAssetData('effect_fade', 'Fade', null)
    const packagePath = fileSystemService.paths.getProjectEffectPackageDirPath('project', asset.id)
    await fileSystemService.createDirectory(packagePath)
    await fileSystemService.writeFile(`${packagePath}/index.js`, 'export default {}')
    await expect(globalMetaFileManager.saveMetaFile(asset)).resolves.toBe(true)

    await expect(globalMetaFileManager.deleteAssetFiles(asset)).resolves.toEqual({
      success: true,
      deletedMedia: true,
      deletedMeta: true,
    })
    expect(memory.files.size).toBe(0)
  })
})
