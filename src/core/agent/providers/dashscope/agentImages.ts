import { fetchClient } from '@/utils/fetchClient'
import {
  CfBailianTempFileUploader,
  type UploadPolicyData,
} from '@/core/utils/cfBailianTempFileUploader'
import type {
  AgentImageUploadInput,
  AgentImageUploadScope,
} from '../../services/agentProviderService'
import type { ProviderUpload } from '../../types'

export function validDashScopeAgentReference(value: string) {
  return (
    /^oss:\/\/dashscope-instant\/[A-Za-z0-9_./-]+$/.test(value) &&
    !value
      .slice(6)
      .split('/')
      .some((part) => part === '.' || part === '..')
  )
}

export async function uploadDashScopeAgentImage(
  blob: Blob,
  input: AgentImageUploadInput,
  scope: AgentImageUploadScope,
  signal: AbortSignal,
): Promise<ProviderUpload> {
  const query = new URLSearchParams({
    project_id: scope.projectId,
  })
  const response = await fetchClient.post<{ data: UploadPolicyData; expires_at: string }>(
    `/api/providers/dashscope/agent/uploads?${query}`,
    {
      file_name: input.fileName,
      mime_type: input.mimeType,
      byte_size: input.byteSize,
      width: input.width,
      height: input.height,
    },
    { signal, headers: { 'X-Lightcut-Agent-Route-Hash': scope.provider.route_hash } },
  )
  signal.throwIfAborted()
  const policy = response.data.data
  if (!policy || !validDashScopeAgentReference(policy.object_ref))
    throw new Error('图片上传服务返回了无效引用')
  const reference = await CfBailianTempFileUploader.uploadBlobToOss(blob, policy, undefined, signal)
  return { providerId: scope.provider.id, reference, expiresAt: response.data.expires_at }
}
