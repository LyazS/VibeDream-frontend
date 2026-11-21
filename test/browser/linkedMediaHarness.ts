import {
  AudioBufferSink,
  BlobSource,
  Input,
  MP4,
  QUALITY_MEDIUM,
  VideoSampleSink,
} from 'mediabunny'
import {
  createTemporaryVideoTimelineItem,
  createMediaIndexTaskSubmitRequest,
} from '@/core/jobs/resolvers/mediaIndexingShared'
import { MediaIndexTaskSubmitResolver } from '@/core/jobs/resolvers/MediaIndexTaskSubmitResolver'
import { createResourceNode } from '@/core/jobs/ResourceTypes'
import { setupTimelineItemBunny } from '@/core/bunnyUtils/timelineItemSetup'
import { useUnifiedStore } from '@/core/unifiedStore'
import { fileSystemService } from '@/core/managers/filesystem/fileSystemService'
import { globalMetaFileManager } from '@/core/managers/media/globalMetaFileManager'
import { unifiedProjectManager } from '@/core/managers/project/UnifiedProjectManager'
import { indexedDBService } from '@/core/storage/IndexedDBService'
import { hashFile } from '@/core/utils/hashFile'
import { ExportManager } from '@/core/utils/projectExporter'
import { FileSystemAccessAdapter } from '@/core/filesystem/adapters/FileSystemAccessAdapter'
import { relinkMediaFromPicker } from '@/core/datasource/providers/linked-file/LinkedMediaRecovery'
import { importLinkedMedia } from '@/core/media-import/LinkedMediaImportService'
import type { VideoMediaItem } from '@/core/mediaitem/types'

export { createProject, projectReady, importVideo } from './opfsHarness'

/** OPFS handles here are real Chromium handles stored outside the workspace; the picker is injected. */
async function directory(path = '', create = false) {
  let handle = await (
    await navigator.storage.getDirectory()
  ).getDirectoryHandle('linked-media-fixtures', { create: true })
  for (const name of path.split('/').filter(Boolean))
    handle = await handle.getDirectoryHandle(name, { create })
  return handle
}

async function fixtureFile(path: string, create = false) {
  const parts = path.split('/')
  const name = parts.pop()!
  return (await directory(parts.join('/'), create)).getFileHandle(name, { create })
}

export async function seedMedia(path: string, fixture: 'red' | 'green-tone' | 'invalid' = 'red') {
  const file = await fixtureFile(path, true)
  const writable = await file.createWritable()
  await writable.write(
    fixture === 'invalid'
      ? 'unsupported'
      : await (await fetch(`/test/browser/fixtures/${fixture}.webm`)).blob(),
  )
  await writable.close()
  return hashFile(await file.getFile())
}

export function chooseDirectory(path: string) {
  window.showDirectoryPicker = async (options) => {
    if (options?.mode !== 'read') throw new Error('Expected read-only directory picker')
    return directory(path)
  }
}

export function chooseFiles(paths: string[]) {
  window.showOpenFilePicker = async () => Promise.all(paths.map((path) => fixtureFile(path)))
}

export async function protectWorkspaceProjects(path: string) {
  const workspace = await directory(path)
  const previous = window.showDirectoryPicker
  window.showDirectoryPicker = async () => workspace
  try {
    const adapter = new FileSystemAccessAdapter()
    await adapter.checkPermission(true)
    fileSystemService.getManagedProjectsRoot = () => adapter.getManagedProjectsRoot()
  } finally {
    window.showDirectoryPicker = previous
  }
}

export async function originalDigest(path: string) {
  return hashFile(await (await fixtureFile(path)).getFile())
}

export async function changeMedia(path: string, sameSize: boolean) {
  const handle = await fixtureFile(path)
  const bytes = new Uint8Array(await (await handle.getFile()).arrayBuffer())
  // Change a byte near the end of the container. No truncation is needed for the same-size case.
  bytes[bytes.length - 1] = bytes[bytes.length - 1]! ^ 1
  const writable = await handle.createWritable()
  await writable.write(sameSize ? bytes : bytes.subarray(0, bytes.length - 1))
  await writable.close()
}

export function getMedia() {
  const store = useUnifiedStore()
  return store.getAllMediaItems().map((item) => ({
    id: item.id,
    name: item.name,
    status: item.mediaStatus,
    directory: store.getDirectory(item.parentDirectoryId)?.name ?? '',
    source: item.source.type === 'linked-file' ? item.source.record : { type: item.source.type },
    issue: item.source.type === 'linked-file' ? item.source.issue : undefined,
    thumbnail: !!item.runtime.bunny?.thumbnailUrl,
  }))
}

export async function mediaFolderEntries(projectId = useUnifiedStore().projectId) {
  return (await fileSystemService.listDirectory(fileSystemService.paths.getMediaDirPath(projectId)))
    .map(({ name }) => name)
    .sort()
}

export async function getBindingIds(projectId = useUnifiedStore().projectId) {
  const keys = await indexedDBService.transaction('linkedMediaHandles', 'readonly', (table) =>
    table.getAllKeys(),
  )
  return keys
    .filter(
      (key): key is [string, string, string] =>
        Array.isArray(key) && key[0] === fileSystemService.workspaceKey && key[1] === projectId,
    )
    .map((key) => key[2])
}

export async function clearBindings(projectId = useUnifiedStore().projectId) {
  for (const id of await getBindingIds(projectId)) {
    await indexedDBService.transaction('linkedMediaHandles', 'readwrite', (table) =>
      table.delete([fileSystemService.workspaceKey!, projectId, id]),
    )
  }
}

export async function createOtherLinkedProject(path: string) {
  const store = useUnifiedStore()
  const other = await unifiedProjectManager.createProject('Other linked project')
  const item = store.getAllMediaItems().find((item) => item.source.type === 'linked-file')
  if (item?.source.type !== 'linked-file' || !item.source.record)
    throw new Error('Need a linked fixture')
  const { registerLinkedHandle } = await import(
    '@/core/datasource/providers/linked-file/LinkedMediaBindings'
  )
  await registerLinkedHandle(
    { workspaceKey: fileSystemService.workspaceKey!, projectId: other.id },
    item.source.record.handleId,
    await directory(path),
  )
  return other.id
}

export async function removeMedia(id: string) {
  const store = useUnifiedStore()
  const item = store.getMediaItem(id)!
  const deletion = await store.deleteAssetItem(id, item.parentDirectoryId)
  if (!deletion.success) throw new Error(deletion.error)
}

export async function renameAndMove(id: string, name: string) {
  const store = useUnifiedStore()
  const root = store.getAllDirectories().find((dir) => dir.parentId === null)!
  const result = await store.renameAssetWithHistory(id, name)
  const moved = await store.moveAssetToDirectory(id, root.id)
  if (!moved.success) throw new Error(moved.error)
  return result
}

export async function attachTrimmedClip(id: string, clipStartTime = 32, clipEndTime = 53) {
  const store = useUnifiedStore()
  await store.ensureMediaReady(id)
  const media = store.getMediaItem(id) as VideoMediaItem
  const clip = createTemporaryVideoTimelineItem(media, clipStartTime, clipEndTime, 'linked-trim')
  clip.trackId = store.tracks.find((track) => track.type === 'video')!.id
  // Canvas there can be larger than this deliberately tiny fixture.
  clip.baseRenderConfig.visual.x = 0
  clip.baseRenderConfig.visual.y = 0
  await setupTimelineItemBunny(clip, media)
  await store.addTimelineItem(clip)
  await store.saveCurrentProject({ contentChanged: true })
  return getClip()
}

export function getClip() {
  const clip = useUnifiedStore().getTimelineItem('linked-trim')
  if (!clip) return null
  return {
    mediaId: clip.mediaItemId,
    status: clip.timelineStatus,
    timeRange: JSON.parse(JSON.stringify(clip.timeRange)),
  }
}

export async function exportAndInspect() {
  const store = useUnifiedStore()
  const exporter = new ExportManager({
    exportType: 'video',
    videoWidth: 64,
    videoHeight: 48,
    projectName: 'Linked media regression',
    timelineItems: store.timelineItems,
    tracks: store.tracks,
    getMediaItem: store.getMediaItem,
    videoQuality: QUALITY_MEDIUM,
    audioQuality: QUALITY_MEDIUM,
  })
  const bytes = await exporter.export()
  const input = new Input({
    source: new BlobSource(new Blob([new Uint8Array(bytes)])),
    formats: [MP4],
  })
  try {
    const video = (await input.getPrimaryVideoTrack())!
    const audio = (await input.getPrimaryAudioTrack())!
    const sample = await new VideoSampleSink(video).getSample(0.15)
    let maxAmplitude = 0
    for await (const frame of new AudioBufferSink(audio).buffers()) {
      const peak = frame.buffer
        .getChannelData(0)
        .reduce((peak, sample) => Math.max(peak, Math.abs(sample)), 0)
      maxAmplitude = Math.max(maxAmplitude, peak)
    }
    const canvas = new OffscreenCanvas(64, 48)
    const rendering = canvas.getContext('2d')!
    sample!.draw(rendering, 0, 0)
    sample!.close()
    return {
      duration: await input.computeDuration(),
      pixel: Array.from(rendering.getImageData(32, 24, 1, 1).data),
      hasSound: maxAmplitude > 0.005,
    }
  } finally {
    input.dispose()
  }
}

export async function readMedia(id: string, verifyContent = true) {
  const media = useUnifiedStore().getMediaItem(id)!
  return hashFile(await globalMetaFileManager.loadMediaFile(media, { verifyContent }))
}

export async function submitIndex(id: string) {
  const store = useUnifiedStore()
  const request = createMediaIndexTaskSubmitRequest(id)
  return new MediaIndexTaskSubmitResolver(store).resolve({
    node: createResourceNode(request),
    input: request.input,
    signal: new AbortController().signal,
    ensure: async () => {
      throw new Error('Indexing must stop before segment export')
    },
    update: () => {},
    emit: () => {},
  })
}

export async function removeContentDigest(id: string) {
  const path = fileSystemService.paths.getMetaPath(useUnifiedStore().projectId, id)
  const meta = JSON.parse(await fileSystemService.readFile(path))
  delete meta.source.contentSha256
  await fileSystemService.writeFile(path, JSON.stringify(meta))
}

export async function relink(id: string, kind: 'directory' | 'file') {
  const store = useUnifiedStore()
  return relinkMediaFromPicker(store, store.getMediaItem(id)!, kind)
}

export function abortBindingCommit() {
  const original = IDBObjectStore.prototype.put
  IDBObjectStore.prototype.put = function (...args) {
    const request = original.apply(this, args)
    if (this.name === 'linkedMediaHandles')
      request.addEventListener('success', () => this.transaction.abort())
    return request
  }
}

export function failMetadataWrite() {
  const original = FileSystemFileHandle.prototype.createWritable
  FileSystemFileHandle.prototype.createWritable = function (...args) {
    if (this.name.endsWith('.meta'))
      return Promise.reject(new Error('Injected metadata write failure'))
    return original.apply(this, args)
  }
}

let waiting = false
let release: (() => void) | undefined

export function holdMetadataWrite() {
  const gate = new Promise<void>((resolve) => {
    release = resolve
  })
  waiting = false
  const writable = FileSystemFileHandle.prototype.createWritable
  FileSystemFileHandle.prototype.createWritable = async function (...args) {
    if (!waiting && this.name.endsWith('.meta')) {
      waiting = true
      await gate
    }
    return writable.apply(this, args)
  }
}

export function waitingForMetadataWrite() {
  return waiting
}
export function releaseMetadataWrite() {
  release?.()
}

export function saveMediaMetaAndReleaseWrite(id: string) {
  const saving = globalMetaFileManager.saveMetaFile(useUnifiedStore().getMediaItem(id)!)
  releaseMetadataWrite()
  return saving
}

export async function deleteProjectAndTestLateWrite(projectId: string) {
  const deleting = unifiedProjectManager.deleteProject(projectId)
  const late = fileSystemService
    .writeFile(fileSystemService.paths.getProjectDirectoriesPath(projectId), 'late')
    .then(
      () => false,
      () => true,
    )
  await deleting
  const last = await fileSystemService
    .writeFile(fileSystemService.paths.getProjectDirectoriesPath(projectId), 'stale')
    .then(
      () => false,
      () => true,
    )
  return {
    rejectedWhileDeleting: await late,
    rejectedAfterDeleting: last,
    exists: await fileSystemService.directoryExists(
      fileSystemService.paths.getProjectPath(projectId),
    ),
    ids: await getBindingIds(projectId),
  }
}

export async function importWithExpiredSession(path: string) {
  const session = new AbortController()
  const stop = new AbortController()
  const root = await directory(path)
  const store = useUnifiedStore()
  return importLinkedMedia(store, [root], store.currentDir!.id, {
    stop: stop.signal,
    signal: session.signal,
    onProgress: (progress) => {
      if (progress.phase === 'processing' && progress.current === 0) session.abort()
    },
  })
}
