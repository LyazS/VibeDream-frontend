import type { TextureResource } from '@/core/webgl2/types'

type UploadSource = TexImageSource

/**
 * 统一管理所有“可被 shader 读取”的 2D texture。
 *
 * 这个类不关心 texture 是视频帧、图片、文本位图还是离屏结果，
 * 它只负责：
 * - 以字符串 ID 建立查找关系
 * - 保证 texture 尺寸与上传源一致
 * - 统一设置第一阶段需要的采样参数
 */
export class TextureManager {
  private readonly textures = new Map<string, TextureResource>()

  constructor(private readonly gl: WebGL2RenderingContext) {}

  /**
   * 确保某个 textureId 对应的 GPU texture 存在且尺寸匹配。
   *
   * 若尺寸不一致，会直接重建 texture。
   * 这样上层不必自己维护 “这张 texture 当前是几乘几” 的额外状态。
   */
  ensureTexture(id: string, width: number, height: number): TextureResource {
    const existing = this.textures.get(id)
    if (existing && existing.width === width && existing.height === height) {
      return existing
    }

    if (existing) {
      this.gl.deleteTexture(existing.texture)
      this.textures.delete(id)
    }

    const texture = this.gl.createTexture()
    if (!texture) {
      throw new Error(`Failed to create texture for ${id}`)
    }

    this.gl.bindTexture(this.gl.TEXTURE_2D, texture)
    this.gl.texParameteri(this.gl.TEXTURE_2D, this.gl.TEXTURE_MIN_FILTER, this.gl.LINEAR)
    this.gl.texParameteri(this.gl.TEXTURE_2D, this.gl.TEXTURE_MAG_FILTER, this.gl.LINEAR)
    this.gl.texParameteri(this.gl.TEXTURE_2D, this.gl.TEXTURE_WRAP_S, this.gl.CLAMP_TO_EDGE)
    this.gl.texParameteri(this.gl.TEXTURE_2D, this.gl.TEXTURE_WRAP_T, this.gl.CLAMP_TO_EDGE)
    this.gl.texImage2D(
      this.gl.TEXTURE_2D,
      0,
      this.gl.RGBA,
      width,
      height,
      0,
      this.gl.RGBA,
      this.gl.UNSIGNED_BYTE,
      null,
    )

    const resource: TextureResource = { id, texture, width, height }
    this.textures.set(id, resource)
    return resource
  }

  /**
   * 把一个可上传源写入指定 texture。
   *
   * 当前策略：
   * - 始终走 `texImage2D`，实现简单，先保证正确性
   *
   * 后续如果要进一步优化视频上传，可以在这里改成尺寸稳定时走 `texSubImage2D`。
   */
  uploadSource(id: string, source: UploadSource, width: number, height: number): TextureResource {
    const resource = this.ensureTexture(id, width, height)

    this.gl.bindTexture(this.gl.TEXTURE_2D, resource.texture)
    this.gl.texImage2D(
      this.gl.TEXTURE_2D,
      0,
      this.gl.RGBA,
      this.gl.RGBA,
      this.gl.UNSIGNED_BYTE,
      source,
    )

    resource.width = width
    resource.height = height
    return resource
  }

  /**
   * 通过逻辑 ID 查回 texture；找不到返回 null，避免上层直接接触 Map。
   */
  get(id: string): TextureResource | null {
    return this.textures.get(id) || null
  }

  /**
   * 释放单个 texture。
   */
  remove(id: string): void {
    const resource = this.textures.get(id)
    if (!resource) return

    this.gl.deleteTexture(resource.texture)
    this.textures.delete(id)
  }

  /**
   * 释放当前管理的全部 texture。
   */
  clear(): void {
    for (const resource of this.textures.values()) {
      this.gl.deleteTexture(resource.texture)
    }
    this.textures.clear()
  }
}
