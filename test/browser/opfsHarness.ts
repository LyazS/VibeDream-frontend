// 仅由测试开发服务器加载，应用入口不会导入或注册这些方法。
import { fileSystemService } from '@/core/managers/filesystem/fileSystemService'
import { unifiedProjectManager } from '@/core/managers/project/UnifiedProjectManager'
import { useUnifiedStore } from '@/core/unifiedStore'
import { indexedDBService } from '@/core/storage/IndexedDBService'
import { createMediaFileImportService } from '@/core/media-import/MediaFileImportService'
import router from '@/router'

export { fileSystemService }

export async function createProject() {
  const project = await unifiedProjectManager.createProject('OPFS media regression')
  await router.push(`/editor/${project.id}`)
  return project.id
}

export function projectReady() {
  const store = useUnifiedStore()
  return store.isProjectSettingsReady && store.isProjectTimelineReady
}

async function digest(blob: Blob) {
  const hash = await crypto.subtle.digest('SHA-256', await blob.arrayBuffer())
  return Array.from(new Uint8Array(hash), (byte) => byte.toString(16).padStart(2, '0')).join('')
}

export async function inspectMedia(mediaId: string) {
  const store = useUnifiedStore()
  await store.ensureMediaReady(mediaId)
  const item = store.getMediaItem(mediaId)
  const bunny = item?.runtime.bunny?.bunnyMedia
  if (!item || !bunny) throw new Error('Imported video was not decoded')
  const frame = await bunny.videoGetSample()?.(0)
  if (!frame) throw new Error('Video has no decodable frame')
  const canvas = new OffscreenCanvas(64, 48)
  const context = canvas.getContext('2d')!
  try {
    frame.draw(context, 0, 0)
    const pixel = Array.from(context.getImageData(32, 24, 1, 1).data)
    const blob = await fileSystemService.readFileAsBlob(
      fileSystemService.paths.getMediaPath(store.projectId, item),
    )
    return {
      mediaId: item.id,
      status: item.mediaStatus,
      width: bunny.width,
      height: bunny.height,
      duration: bunny.duration,
      bytes: blob.size,
      digest: await digest(blob),
      pixel,
    }
  } finally {
    frame.close()
  }
}

export async function importVideo() {
  const store = useUnifiedStore()
  const response = await fetch('/test/browser/fixtures/red.webm')
  if (!response.ok) throw new Error('Missing video fixture')
  const blob = await response.blob()
  const item = await createMediaFileImportService(store).importFile(
    new File([blob], 'red.webm', { type: 'video/webm' }),
    undefined,
    { waitUntilReady: true },
  )
  store.disableAutoSave()
  await store.saveCurrentProject({
    configChanged: true,
    contentChanged: true,
    directoryChanged: true,
  })
  return { ...(await inspectMedia(item.id)), originalDigest: await digest(blob) }
}

export async function writeCheckpoint() {
  const projectId = useUnifiedStore().projectId
  const canvas = new OffscreenCanvas(4, 4)
  canvas.getContext('2d')!.fillRect(0, 0, 4, 4)
  const image = await canvas.convertToBlob({ type: 'image/png' })
  const attachmentPath = await fileSystemService.writeAgentAttachment(
    projectId,
    'fixture',
    'image/png',
    image,
  )
  await indexedDBService.transaction('agentLogs', 'readwrite', (store) =>
    store.put({ key: 'opfs-isolation', owner: 'fixture', sessionKey: 'fixture', marker: 'saved' }),
  )
  localStorage.setItem('opfs-isolation', 'saved')
  return { projectId, attachmentPath, imageDigest: await digest(image) }
}

export async function readCheckpoint(projectId: string, attachmentPath: string) {
  const image = await fileSystemService.readAgentAttachment(projectId, 'fixture', attachmentPath)
  return { imageDigest: await digest(image), ...(await isolationState()) }
}

export async function isolationState() {
  const record = await indexedDBService.transaction<{ marker?: string } | undefined>(
    'agentLogs',
    'readonly',
    (store) => store.get('opfs-isolation'),
  )
  return {
    projects: (await unifiedProjectManager.listProjects()).map((project) => project.id),
    marker: record?.marker ?? null,
    localStorage: localStorage.getItem('opfs-isolation'),
  }
}
