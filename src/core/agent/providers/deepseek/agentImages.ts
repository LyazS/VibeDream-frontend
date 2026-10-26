import { CfDeepSeekTempFileUploader } from '@/core/utils/cfDeepSeekTempFileUploader'
import type {
  AgentImageUploadInput,
  AgentImageUploadScope,
} from '../../services/agentProviderService'
import type { ProviderUpload } from '../../types'

export { validDeepSeekFileReference as validDeepSeekAgentReference } from '@/core/utils/cfDeepSeekTempFileUploader'

export async function uploadDeepSeekAgentImage(
  blob: Blob,
  input: AgentImageUploadInput,
  scope: AgentImageUploadScope,
  signal: AbortSignal,
): Promise<ProviderUpload> {
  const query = new URLSearchParams({ project_id: scope.projectId })
  const uploaded = await CfDeepSeekTempFileUploader.uploadBlob(
    blob,
    {
      uploadUrl: `/api/providers/deepseek/agent/uploads?${query}`,
      fileName: input.fileName,
      width: input.width,
      height: input.height,
      headers: { 'X-Lightcut-Agent-Route-Hash': scope.provider.route_hash },
    },
    signal,
  )
  if (Date.parse(uploaded.expiresAt) <= Date.now() + 11 * 60_000)
    throw new Error('图片上传服务返回了无效引用或有效期')
  return {
    providerId: 'deepseek',
    reference: uploaded.fileId,
    expiresAt: uploaded.expiresAt,
  }
}
