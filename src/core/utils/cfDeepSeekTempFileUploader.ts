import { fetchClient } from '@/utils/fetchClient'

export interface CfDeepSeekTempFileUploadRequest {
  uploadUrl: string
  fileName: string
  width: number
  height: number
  headers?: Record<string, string>
}

export interface CfDeepSeekTempFileUploadResult {
  fileId: string
  expiresAt: string
}

export function validDeepSeekFileReference(value: string): boolean {
  return /^file-api-[A-Za-z0-9_-]{1,200}$/.test(value)
}

export class CfDeepSeekTempFileUploader {
  static async uploadBlob(
    blob: Blob,
    request: CfDeepSeekTempFileUploadRequest,
    signal?: AbortSignal,
  ): Promise<CfDeepSeekTempFileUploadResult> {
    signal?.throwIfAborted()
    const form = new FormData()
    form.set('file', blob, request.fileName)
    form.set('width', String(request.width))
    form.set('height', String(request.height))
    const { data } = await fetchClient.post<{ id: string; expires_at: number }>(
      request.uploadUrl,
      form,
      { signal, headers: request.headers },
    )
    signal?.throwIfAborted()
    if (
      !data ||
      typeof data.id !== 'string' ||
      !validDeepSeekFileReference(data.id) ||
      !Number.isSafeInteger(data.expires_at) ||
      data.expires_at * 1000 <= Date.now() ||
      !Number.isFinite(new Date(data.expires_at * 1000).getTime())
    )
      throw new Error('图片上传服务返回了无效引用或有效期')
    return { fileId: data.id, expiresAt: new Date(data.expires_at * 1000).toISOString() }
  }
}
