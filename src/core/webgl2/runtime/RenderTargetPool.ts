import type { MainRenderTarget, RenderTarget } from '@/core/webgl2/types'
import type { ProgramManager } from '@/core/webgl2/runtime/ProgramManager'
import { TextureManager } from '@/core/webgl2/runtime/TextureManager'
import COPY_FRAGMENT_SHADER from '@/core/webgl2/shaders/copy.frag?raw'
import COPY_VERTEX_SHADER from '@/core/webgl2/shaders/copy.vert?raw'

/**
 * 管理可写入的离屏目标。
 *
 * 第一阶段没有实现真正意义上的“任意 target 池化”，这里只做两件事：
 * - 持久化维护主画面的 ping-pong target
 * - 提供一个按 id 缓存的普通 render target 池
 *
 * 命名保留为 Pool，是因为后续扩展到真正复用 item/effect target 时，
 * 外层接口不需要再大改。
 */
export class RenderTargetPool {
  private _mainTarget: MainRenderTarget | null = null
  private readonly targets = new Map<string, RenderTarget>()
  private readonly mainTargetCopyProgram: WebGLProgram

  constructor(
    private readonly gl: WebGL2RenderingContext,
    private readonly textures: TextureManager,
    programs: Pick<ProgramManager, 'createProgram'>,
    private readonly bindFullscreenQuad: (program: WebGLProgram) => void,
  ) {
    this.mainTargetCopyProgram = programs.createProgram(COPY_VERTEX_SHADER, COPY_FRAGMENT_SHADER)
  }

  get mainTarget(): MainRenderTarget {
    if (!this._mainTarget) {
      throw new Error('Main render target has not been initialized')
    }

    return this._mainTarget
  }

  /**
   * 确保一个普通离屏目标可用。
   *
   * 行为约束：
   * - `textureId` 会注册到 `TextureManager`
   * - 同一 id 在尺寸不变时会复用已有 framebuffer / texture
   * - 尺寸变化时会先释放旧 target，再重建
   */
  ensureRenderTarget(textureId: string, width: number, height: number): RenderTarget {
    const existing = this.targets.get(textureId)
    if (existing && existing.width === width && existing.height === height) {
      return existing
    }

    if (existing) {
      this.releaseRenderTarget(textureId)
    }

    const target = this.createRenderTarget(textureId, width, height)
    this.targets.set(textureId, target)
    return target
  }

  /**
   * 确保主画面的 read/write 双 target 可用且尺寸正确。
   *
   * 主画面是跨 item 复用的长期资源，因此这里会缓存结果；
   * 只有当 canvas 尺寸变化时才整体重建。
   *
   * 当前时序约定：
   * - `swapMainTarget()` 前，最新完整结果保存在 `write`
   * - `swapMainTarget()` 后，最新结果会被提升到 `read`，并同步 copy 回 `write`
   */
  ensureMainTarget(width: number, height: number): MainRenderTarget {
    if (this._mainTarget && this._mainTarget.read.width === width && this._mainTarget.read.height === height) {
      return this._mainTarget
    }

    // 主画面采用 read/write 双 target，composite pass 可以一边读旧结果一边写新结果。
    this.disposeMainTarget()
    this._mainTarget = {
      read: this.createRenderTarget('__main-read__', width, height),
      write: this.createRenderTarget('__main-write__', width, height),
    }
    return this._mainTarget
  }

  /**
   * 轮换主画面的 ping-pong 双缓冲，并把最新完整结果复制回可写目标。
   *
   * 行为约定：
   * - 原 write 变成新的 read，代表上一轮 composite 产出的最新主画面
   * - 原 read 变成新的 write，作为当前 composite 的写入目标
   * - 随后执行一次 read -> write 的全屏 copy，保证局部绘制前 write 已持有完整底图
   */
  swapMainTarget(): void {
    const currentRead = this.mainTarget.read
    this.mainTarget.read = this.mainTarget.write
    this.mainTarget.write = currentRead
    this.copyRenderTarget(this.mainTarget.read, this.mainTarget.write)
  }

  /**
   * 释放主画面双 target 及其绑定的 texture。
   */
  disposeMainTarget(): void {
    if (!this._mainTarget) return

    this.gl.deleteFramebuffer(this._mainTarget.read.framebuffer)
    this.gl.deleteFramebuffer(this._mainTarget.write.framebuffer)
    this.textures.remove(this._mainTarget.read.textureId)
    this.textures.remove(this._mainTarget.write.textureId)
    this._mainTarget = null
  }

  /**
   * 按 textureId 释放普通 render target。
   */
  releaseRenderTarget(textureId: string): void {
    const target = this.targets.get(textureId)
    if (!target) {
      return
    }

    this.gl.deleteFramebuffer(target.framebuffer)
    this.textures.remove(target.textureId)
    this.targets.delete(textureId)
  }

  /**
   * 清空当前池内的长期资源。
   */
  clear(): void {
    this.disposeMainTarget()
    for (const textureId of [...this.targets.keys()]) {
      this.releaseRenderTarget(textureId)
    }
  }

  private copyRenderTarget(source: RenderTarget, destination: RenderTarget): void {
    this.gl.bindFramebuffer(this.gl.FRAMEBUFFER, destination.framebuffer)
    this.gl.viewport(0, 0, destination.width, destination.height)
    this.gl.useProgram(this.mainTargetCopyProgram)
    this.bindFullscreenQuad(this.mainTargetCopyProgram)

    this.gl.activeTexture(this.gl.TEXTURE0)
    this.gl.bindTexture(this.gl.TEXTURE_2D, source.texture)
    this.gl.uniform1i(this.gl.getUniformLocation(this.mainTargetCopyProgram, 'u_texture'), 0)
    this.gl.drawArrays(this.gl.TRIANGLES, 0, 6)
  }

  private createRenderTarget(textureId: string, width: number, height: number): RenderTarget {
    const textureResource = this.textures.ensureTexture(textureId, width, height)
    const framebuffer = this.gl.createFramebuffer()
    if (!framebuffer) {
      throw new Error(`Failed to create framebuffer for ${textureId}`)
    }

    this.gl.bindFramebuffer(this.gl.FRAMEBUFFER, framebuffer)
    this.gl.framebufferTexture2D(
      this.gl.FRAMEBUFFER,
      this.gl.COLOR_ATTACHMENT0,
      this.gl.TEXTURE_2D,
      textureResource.texture,
      0,
    )

    if (this.gl.checkFramebufferStatus(this.gl.FRAMEBUFFER) !== this.gl.FRAMEBUFFER_COMPLETE) {
      this.gl.deleteFramebuffer(framebuffer)
      throw new Error(`Framebuffer incomplete for ${textureId}`)
    }

    return {
      framebuffer,
      textureId,
      texture: textureResource.texture,
      width,
      height,
    }
  }
}
