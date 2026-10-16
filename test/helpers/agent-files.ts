import { vi } from 'vitest'
import { FileSystemService } from '../../src/core/filesystem/core/FileSystemService'
import type { IFileSystemAdapter } from '../../src/core/filesystem/interfaces'
import type { AgentImage } from '../../src/core/agent/types'

export const agentFiles = new Map<string, Blob>()
const missing = () => new DOMException('File not found', 'NotFoundError')
export const agentFileAdapter = {
  isSupported: () => true,
  getName: () => 'AgentTestFiles',
  readFileAsBlob: vi.fn(async (path: string) => {
    const file = agentFiles.get(path)
    if (!file) throw missing()
    return file
  }),
  writeFile: vi.fn(async (path: string, content: string | Blob) => {
    agentFiles.set(path, typeof content === 'string' ? new Blob([content]) : content)
  }),
  deleteFile: vi.fn(async (path: string) => {
    if (!agentFiles.delete(path)) throw missing()
  }),
  listDirectory: vi.fn(async (directory: string) => {
    const entries = new Map<string, { name: string; kind: 'file' | 'directory'; path: string }>()
    for (const path of agentFiles.keys()) {
      if (!path.startsWith(`${directory}/`)) continue
      const parts = path.slice(directory.length + 1).split('/')
      const name = parts[0]!
      entries.set(name, {
        name,
        kind: parts.length > 1 ? 'directory' : 'file',
        path: `${directory}/${name}`,
      })
    }
    return [...entries.values()]
  }),
} as unknown as IFileSystemAdapter

export const agentFileSystem = new FileSystemService(agentFileAdapter)

export function agentImageFixture(
  id = crypto.randomUUID(),
  userId = 'u1',
  projectId = 'p1',
): AgentImage {
  const original = new Blob(['original image bytes'], { type: 'image/png' })
  const relativePath = agentFileSystem.paths.getAgentAttachmentPath(projectId, id, 'image/png')
  agentFiles.set(relativePath, original)
  return {
    id,
    userId,
    projectId,
    original: {
      relativePath,
      fileName: 'source.png',
      mimeType: 'image/png',
      byteSize: original.size,
      width: 100,
      height: 80,
    },
    conversionParams: {
      width: 100,
      height: 80,
      mimeType: 'image/webp',
      quality: 0.9,
    },
    blob: new Blob(['encoded'], { type: 'image/webp' }),
  }
}
