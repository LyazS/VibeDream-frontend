import { afterEach, expect, it, vi } from 'vitest'
import {
  uploadAgentImage,
  validProviderUpload,
} from '../src/core/agent/services/agentProviderService'
import { assertApiCapabilityEnabled } from '../src/config/apiCapabilities'
import { CfDeepSeekTempFileUploader } from '../src/core/utils/cfDeepSeekTempFileUploader'

const scope = { provider: { id: 'deepseek', route_hash: 'a'.repeat(64) }, projectId: 'project' }
const input = {
  fileName: 'image.webp',
  mimeType: 'image/webp',
  byteSize: 5,
  width: 100,
  height: 80,
}
const blob = () => new Blob(['image'], { type: 'image/webp' })
afterEach(() => vi.unstubAllGlobals())

it('exposes a standalone uploader returning file metadata without Agent types or cache policy', async () => {
  const expires = Math.floor(Date.now() / 1000) + 5 * 60
  const fetcher = vi.fn<typeof fetch>(async () =>
    Response.json({ id: 'file-api-direct', expires_at: expires }),
  )
  vi.stubGlobal('fetch', fetcher)
  const result = await CfDeepSeekTempFileUploader.uploadBlob(blob(), {
    uploadUrl: '/api/providers/deepseek/agent/uploads?project_id=direct',
    fileName: input.fileName,
    width: input.width,
    height: input.height,
    headers: { 'X-Lightcut-Agent-Route-Hash': scope.provider.route_hash },
  })
  expect(result).toEqual({
    fileId: 'file-api-direct',
    expiresAt: new Date(expires * 1000).toISOString(),
  })
  expect(fetcher).toHaveBeenCalledOnce()
  expect(fetcher.mock.calls[0]?.[0]).toBe('/api/providers/deepseek/agent/uploads?project_id=direct')
})

it('keeps the Agent minimum lifetime check outside the standalone uploader', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () =>
      Response.json({
        id: 'file-api-near-expiry',
        expires_at: Math.floor(Date.now() / 1000) + 5 * 60,
      }),
    ),
  )
  await expect(
    uploadAgentImage(blob(), input, scope, new AbortController().signal),
  ).rejects.toThrow('无效引用或有效期')
})

it('sends actual multipart bytes through authenticated FetchClient and preserves provider expiration', async () => {
  const expires = Math.floor(Date.now() / 1000) + 172000
  const fetcher = vi.fn(async () => Response.json({ id: 'file-api-uploaded', expires_at: expires }))
  vi.stubGlobal('fetch', fetcher)
  const controller = new AbortController()
  const result = await uploadAgentImage(blob(), input, scope, controller.signal)
  expect(result).toEqual({
    providerId: 'deepseek',
    reference: 'file-api-uploaded',
    expiresAt: new Date(expires * 1000).toISOString(),
  })
  const [url, init] = fetcher.mock.calls[0] as unknown as [string, RequestInit]
  expect(url).toBe('/api/providers/deepseek/agent/uploads?project_id=project')
  expect(init.credentials).toBe('include')
  expect(init.signal).toBe(controller.signal)
  const headers = new Headers(init.headers)
  expect(headers.has('Content-Type')).toBe(false)
  expect(headers.get('X-Lightcut-Agent-Route-Hash')).toBe(scope.provider.route_hash)
  expect(init.body).toBeInstanceOf(FormData)
  const form = init.body as FormData
  expect(await (form.get('file') as File).text()).toBe('image')
  expect(form.get('width')).toBe('100')
  expect(form.get('height')).toBe('80')
  expect(() => assertApiCapabilityEnabled(url)).not.toThrow()
})

it.each([
  { id: 'https://example.com/a', expires_at: 9999999999 },
  { id: 'file-api-../x', expires_at: 9999999999 },
  { id: 'file-api-test' },
  { id: 'file-api-test', expires_at: 1 },
  { id: 'file-api-test', expires_at: '9999999999' },
  { id: 'file-api-test', expires_at: 9999999999.5 },
])('rejects malformed provider file responses: %j', async (data) => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => Response.json(data)),
  )
  await expect(
    uploadAgentImage(blob(), input, scope, new AbortController().signal),
  ).rejects.toThrow('无效引用或有效期')
})

it('uses the shared provider/expiry cache policy including the near-expiry margin', () => {
  const upload = {
    providerId: 'deepseek',
    reference: 'file-api-cache',
    expiresAt: new Date(Date.now() + 12 * 60_000).toISOString(),
  }
  expect(validProviderUpload(upload, 'deepseek')).toBe(true)
  expect(validProviderUpload(upload, 'dashscope')).toBe(false)
  expect(
    validProviderUpload(
      { ...upload, expiresAt: new Date(Date.now() + 10 * 60_000).toISOString() },
      'deepseek',
    ),
  ).toBe(false)
})

it('propagates provider changes without a hidden retry', async () => {
  const fetcher = vi.fn(async () =>
    Response.json(
      { error: 'AGENT_PROVIDER_CHANGED', message: 'provider changed', provider: scope.provider },
      { status: 409 },
    ),
  )
  vi.stubGlobal('fetch', fetcher)
  await expect(
    uploadAgentImage(blob(), input, scope, new AbortController().signal),
  ).rejects.toMatchObject({ code: 'AGENT_PROVIDER_CHANGED', status: 409 })
  expect(fetcher).toHaveBeenCalledOnce()
})

it('prevents cancelled uploads and ignores responses after cancellation', async () => {
  const controller = new AbortController()
  const fetcher = vi.fn(async () => {
    controller.abort()
    return Response.json({ id: 'file-api-late', expires_at: 9999999999 })
  })
  vi.stubGlobal('fetch', fetcher)
  await expect(uploadAgentImage(blob(), input, scope, controller.signal)).rejects.toMatchObject({
    name: 'AbortError',
  })
  expect(fetcher).toHaveBeenCalledOnce()
  await expect(uploadAgentImage(blob(), input, scope, controller.signal)).rejects.toMatchObject({
    name: 'AbortError',
  })
  expect(fetcher).toHaveBeenCalledOnce()
})
