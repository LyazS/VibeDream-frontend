import { afterEach, expect, it, vi } from 'vitest'
import { getAgentProvider, uploadAgentImage } from '../src/core/agent/services/agentProviderService'
import { CfBailianTempFileUploader } from '../src/core/utils/cfBailianTempFileUploader'

const provider = { id: 'dashscope', route_hash: 'a'.repeat(64) }
const scope = { provider, projectId: 'project' }
const input = {
  fileName: 'image.webp',
  mimeType: 'image/webp',
  byteSize: 5,
  width: 100,
  height: 80,
}

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

it('queries an authenticated current provider snapshot and rejects invalid snapshots', async () => {
  const fetcher = vi
    .fn()
    .mockResolvedValueOnce(Response.json({ provider }))
    .mockResolvedValueOnce(
      Response.json({ provider: { id: 'dashscope', route_hash: 'model-name' } }),
    )
  vi.stubGlobal('fetch', fetcher)
  const signal = new AbortController().signal
  expect(await getAgentProvider(scope.projectId, signal)).toEqual(provider)
  expect(fetcher.mock.calls[0]).toEqual([
    '/api/agent/provider?project_id=project',
    expect.objectContaining({ credentials: 'include', signal }),
  ])
  await expect(getAgentProvider(scope.projectId, signal)).rejects.toThrow(
    'PROTOCOL_INVALID',
  )
})

it('dispatches image preparation to the provider endpoint and normalizes its opaque upload reference', async () => {
  const reference = 'oss://dashscope-instant/project/image.webp'
  const policy = { object_ref: reference }
  const expiresAt = new Date(Date.now() + 3600000).toISOString()
  const fetcher = vi.fn().mockResolvedValue(Response.json({ data: policy, expires_at: expiresAt }))
  vi.stubGlobal('fetch', fetcher)
  const directUpload = vi
    .spyOn(CfBailianTempFileUploader, 'uploadBlobToOss')
    .mockResolvedValue(reference)
  const blob = new Blob(['image'], { type: 'image/webp' })
  const signal = new AbortController().signal
  expect(await uploadAgentImage(blob, input, scope, signal)).toEqual({
    providerId: provider.id,
    reference,
    expiresAt,
  })
  expect(fetcher.mock.calls[0][0]).toBe(
    '/api/providers/dashscope/agent/uploads?project_id=project',
  )
  expect(JSON.parse(fetcher.mock.calls[0][1].body)).toEqual({
    file_name: input.fileName,
    mime_type: input.mimeType,
    byte_size: input.byteSize,
    width: input.width,
    height: input.height,
  })
  expect(directUpload).toHaveBeenCalledWith(blob, policy, undefined, signal)
  expect(fetcher.mock.calls[0][1].headers['X-Lightcut-Agent-Route-Hash']).toBe(provider.route_hash)
})

it('preserves provider change errors and refuses invalid policies before uploading', async () => {
  const fetcher = vi
    .fn()
    .mockResolvedValueOnce(Response.json({ error: 'AGENT_PROVIDER_CHANGED' }, { status: 409 }))
    .mockResolvedValueOnce(
      Response.json({ data: { object_ref: 'https://example.com/image.webp' } }),
    )
  vi.stubGlobal('fetch', fetcher)
  const directUpload = vi.spyOn(CfBailianTempFileUploader, 'uploadBlobToOss')
  const blob = new Blob(['image'])
  const signal = new AbortController().signal
  await expect(uploadAgentImage(blob, input, scope, signal)).rejects.toMatchObject({
    code: 'AGENT_PROVIDER_CHANGED',
  })
  await expect(uploadAgentImage(blob, input, scope, signal)).rejects.toThrow('无效引用')
  expect(directUpload).not.toHaveBeenCalled()
})

it('rejects image preparation for a provider without image support before making a request', async () => {
  const fetcher = vi.fn()
  vi.stubGlobal('fetch', fetcher)
  await expect(
    uploadAgentImage(
      new Blob(['image']),
      input,
      { ...scope, provider: { ...provider, id: 'text-only' } },
      new AbortController().signal,
    ),
  ).rejects.toMatchObject({ code: 'AGENT_IMAGES_UNSUPPORTED' })
  expect(fetcher).not.toHaveBeenCalled()
})
