import { fetchClient } from '@/utils/fetchClient'

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

export type DashScopeUploadPurpose = 'tagging' | 'embedding' | 'inspection'

export interface DashScopeUploadResult {
  success: boolean
  url?: string
  error?: string
}

export class DashScopeTemporaryFileUploader {
  private static async getUploadPolicy(
    purpose: DashScopeUploadPurpose,
    fileName: string,
  ): Promise<UploadPolicyData> {
    const params = new URLSearchParams({ purpose, file_name: fileName })
    const response = await fetchClient.get<UploadPolicyResponse>(
      `/api/media/indexing/upload-policy?${params.toString()}`,
    )

    if (response.status !== 200) {
      throw new Error(`获取上传 policy 失败: ${response.statusText}`)
    }

    if (!response.data?.data) {
      throw new Error('获取上传 policy 返回数据为空')
    }

    return response.data.data
  }

  private static async uploadBlobToOss(
    blob: Blob,
    policyData: UploadPolicyData,
    onProgress?: (progress: number) => void,
  ): Promise<string> {
    const formData = new FormData()
    formData.append('OSSAccessKeyId', policyData.oss_access_key_id)
    formData.append('policy', policyData.policy)
    formData.append('Signature', policyData.signature)
    formData.append('key', policyData.key)
    formData.append('x-oss-object-acl', policyData.x_oss_object_acl)
    formData.append('x-oss-forbid-overwrite', policyData.x_oss_forbid_overwrite)
    formData.append('file', blob)

    const xhr = await new Promise<XMLHttpRequest>((resolve, reject) => {
      const xhr = new XMLHttpRequest()
      xhr.open('POST', policyData.upload_host)

      xhr.upload.onprogress = (event) => {
        if (event.lengthComputable && onProgress) {
          onProgress(Math.round((event.loaded / event.total) * 100))
        }
      }

      xhr.onload = () => resolve(xhr)
      xhr.onerror = () => reject(new Error(`OSS 直传失败: HTTP ${xhr.status}`))

      xhr.send(formData)
    })

    if (xhr.status < 200 || xhr.status >= 300) {
      throw new Error(`OSS 直传失败: HTTP ${xhr.status} ${xhr.responseText}`)
    }

    return `oss://${policyData.key}`
  }

  static async uploadBlob(
    blob: Blob,
    fileName: string,
    purpose: DashScopeUploadPurpose,
    onProgress?: (progress: number) => void,
  ): Promise<DashScopeUploadResult> {
    try {
      onProgress?.(10)
      const policyData = await this.getUploadPolicy(purpose, fileName)

      onProgress?.(20)
      const ossUrl = await this.uploadBlobToOss(blob, policyData, (p) => {
        onProgress?.(20 + Math.round(p * 0.8))
      })

      onProgress?.(100)
      return { success: true, url: ossUrl }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : '百炼临时文件上传失败',
      }
    }
  }
}
