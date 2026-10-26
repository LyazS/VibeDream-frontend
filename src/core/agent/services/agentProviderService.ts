import { fetchClient } from '@/utils/fetchClient'
import type { ProviderUpload } from '../types'
import {
  uploadDashScopeAgentImage,
  validDashScopeAgentReference,
} from '../providers/dashscope/agentImages'
import {
  uploadDeepSeekAgentImage,
  validDeepSeekAgentReference,
} from '../providers/deepseek/agentImages'

export type AgentProviderSnapshot = { id: string; route_hash: string }
export type AgentImageUploadScope = {
  provider: AgentProviderSnapshot
  projectId: string
}
export type AgentImageUploadInput = {
  fileName: string
  mimeType: string
  byteSize: number
  width: number
  height: number
}

export function validAgentProviderSnapshot(value: unknown): value is AgentProviderSnapshot {
  if (!value || typeof value !== 'object') return false
  const v = value as Record<string, unknown>
  return (
    typeof v.id === 'string' &&
    /^[A-Za-z0-9._:-]{1,128}$/.test(v.id) &&
    typeof v.route_hash === 'string' &&
    /^[a-f0-9]{64}$/.test(v.route_hash)
  )
}

export async function getAgentProvider(
  projectId: string,
  signal: AbortSignal,
): Promise<AgentProviderSnapshot> {
  const query = new URLSearchParams({ project_id: projectId })
  const { data } = await fetchClient.get<{ provider: AgentProviderSnapshot }>(
    `/api/agent/provider?${query}`,
    { signal },
  )
  if (!validAgentProviderSnapshot(data.provider)) throw new Error('PROTOCOL_INVALID')
  return data.provider
}

export const agentImageAdapters: ReadonlyMap<
  string,
  {
    validReference(reference: string): boolean
    upload(
      blob: Blob,
      input: AgentImageUploadInput,
      scope: AgentImageUploadScope,
      signal: AbortSignal,
    ): Promise<ProviderUpload>
  }
> = new Map([
  ['deepseek', { validReference: validDeepSeekAgentReference, upload: uploadDeepSeekAgentImage }],
  [
    'dashscope',
    { validReference: validDashScopeAgentReference, upload: uploadDashScopeAgentImage },
  ],
])

export function validProviderUpload(
  upload: ProviderUpload | undefined,
  providerId: string,
): upload is ProviderUpload {
  return Boolean(
    upload &&
      upload.providerId === providerId &&
      typeof upload.reference === 'string' &&
      agentImageAdapters.get(providerId)?.validReference(upload.reference) &&
      typeof upload.expiresAt === 'string' &&
      Date.parse(upload.expiresAt) > Date.now() + 11 * 60_000,
  )
}

export async function uploadAgentImage(
  blob: Blob,
  input: AgentImageUploadInput,
  scope: AgentImageUploadScope,
  signal: AbortSignal,
): Promise<ProviderUpload> {
  const adapter = agentImageAdapters.get(scope.provider.id)
  if (!adapter)
    throw Object.assign(new Error('当前供应商不支持对话图片'), { code: 'AGENT_IMAGES_UNSUPPORTED' })
  return adapter.upload(blob, input, scope, signal)
}
