import { fetchClient } from '@/utils/fetchClient'

// Worker 目前只为 indexing 签发 policy。新增能力必须同时扩展 Worker 白名单与这里的联合类型，
// 防止前端在后端尚未授权时误申请任意用途的上传凭证。
export type MediaUploadCapability = 'indexing'
export type MediaUploadPurpose = 'tagging' | 'embedding'

export interface TemporaryFileUploadRequest {
  capability: MediaUploadCapability
  purpose: MediaUploadPurpose
  fileName: string
}

interface UploadPolicyData {
  upload_host: string
  upload_dir: string
  oss_access_key_id: string
  signature: string
  policy: string
  x_oss_object_acl: string
  x_oss_forbid_overwrite: string
  key: string
}

interface UploadPolicyResponse {
  data: UploadPolicyData
}

export interface TemporaryFileUploadResult {
  success: boolean
  url?: string
  error?: string
}

/**
 * 通过 Cloudflare Worker 申请短期 OSS policy 后直传文件。
 * Worker 从不代理文件字节：大文件不占用 Worker 执行时间，且 DashScope API Key 不会暴露到浏览器。
 */
export class CloudflareTemporaryFileUploader {
  private static async getUploadPolicy(
    request: TemporaryFileUploadRequest,
    signal?: AbortSignal,
  ): Promise<UploadPolicyData> {
    const response = await fetchClient.post<UploadPolicyResponse>('/api/media/upload-policies', {
      capability: request.capability,
      purpose: request.purpose,
      file_name: request.fileName,
    }, { signal })
    if (!response.data?.data) throw new Error('获取临时上传 policy 返回数据为空')
    return response.data.data
  }

  private static async uploadBlobToOss(
    blob: Blob,
    policyData: UploadPolicyData,
    onProgress?: (progress: number) => void,
    signal?: AbortSignal,
  ): Promise<string> {
    signal?.throwIfAborted()
    // OSS policy 字段必须原样提交；使用 XHR 而不是 fetch 是为了向资源 Resolver 汇报上传进度。
    const formData = new FormData()
    formData.append('OSSAccessKeyId', policyData.oss_access_key_id)
    formData.append('policy', policyData.policy)
    formData.append('Signature', policyData.signature)
    formData.append('key', policyData.key)
    formData.append('x-oss-object-acl', policyData.x_oss_object_acl)
    formData.append('x-oss-forbid-overwrite', policyData.x_oss_forbid_overwrite)
    formData.append('file', blob)

    const xhr = await new Promise<XMLHttpRequest>((resolve, reject) => {
      const upload = new XMLHttpRequest()
      const abort = () => upload.abort()
      signal?.addEventListener('abort', abort, { once: true })
      const finish = () => signal?.removeEventListener('abort', abort)
      upload.open('POST', policyData.upload_host)
      upload.upload.onprogress = (event) => {
        if (event.lengthComputable) onProgress?.(Math.round((event.loaded / event.total) * 100))
      }
      upload.onload = () => { finish(); resolve(upload) }
      upload.onerror = () => { finish(); reject(new Error(`临时文件 OSS 直传失败: HTTP ${upload.status}`)) }
      upload.onabort = () => { finish(); reject(new DOMException('上传已取消', 'AbortError')) }
      if (signal?.aborted) {
        finish()
        reject(new DOMException('上传已取消', 'AbortError'))
        return
      }
      upload.send(formData)
    })
    if (xhr.status < 200 || xhr.status >= 300) {
      throw new Error(`临时文件 OSS 直传失败: HTTP ${xhr.status} ${xhr.responseText}`)
    }
    return `oss://${policyData.key}`
  }

  static async uploadBlob(
    blob: Blob,
    request: TemporaryFileUploadRequest,
    onProgress?: (progress: number) => void,
    signal?: AbortSignal,
  ): Promise<TemporaryFileUploadResult> {
    try {
      signal?.throwIfAborted()
      // 进度前 20% 表示申请 policy，剩余 80% 映射到实际 OSS 上传，供调用方组合任务总进度。
      onProgress?.(10)
      const policy = await this.getUploadPolicy(request, signal)
      signal?.throwIfAborted()
      onProgress?.(20)
      const url = await this.uploadBlobToOss(blob, policy, (progress) => {
        onProgress?.(20 + Math.round(progress * 0.8))
      }, signal)
      onProgress?.(100)
      return { success: true, url }
    } catch (error) {
      if (signal?.aborted) throw new DOMException('上传已取消', 'AbortError')
      return {
        success: false,
        error: error instanceof Error ? error.message : '临时文件上传失败',
      }
    }
  }
}
