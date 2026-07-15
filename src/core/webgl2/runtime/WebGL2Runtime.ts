import { ProgramManager } from '@/core/webgl2/runtime/ProgramManager'
import { RenderTargetPool } from '@/core/webgl2/runtime/RenderTargetPool'
import { TextureManager } from '@/core/webgl2/runtime/TextureManager'

/**
 * WebGL2 基础运行时。
 *
 * 这里是所有渲染基础设施的装配点，负责维护：
 * - WebGL2RenderingContext
 * - shader program 缓存
 * - texture 注册与查找
 * - render target 管理
 * - 供多个 pass 复用的标准几何 buffer
 */
export class WebGL2Runtime {
  readonly gl: WebGL2RenderingContext
  readonly programs: ProgramManager
  readonly textures: TextureManager
  readonly targets: RenderTargetPool

  private readonly fullscreenBuffer: WebGLBuffer
  private readonly quadBuffer: WebGLBuffer

  constructor(canvas: HTMLCanvasElement) {
    const gl = canvas.getContext('webgl2', {
      alpha: true,
      premultipliedAlpha: true,
      antialias: true,
    })

    if (!gl) {
      throw new Error('无法获取 WebGL2 上下文')
    }

    this.gl = gl
    this.programs = new ProgramManager(gl)
    this.textures = new TextureManager(gl)
    this.targets = new RenderTargetPool(
      gl,
      this.textures,
      this.programs,
      (program) => this.bindFullscreenQuad(program),
    )
    // fullscreenBuffer 给 composite/present 用；quadBuffer 给基于 item 变换的 source draw 用。
    this.fullscreenBuffer = this.createBuffer(new Float32Array([
      -1, -1,
      1, -1,
      -1, 1,
      -1, 1,
      1, -1,
      1, 1,
    ]))
    this.quadBuffer = this.createBuffer(new Float32Array([
      -0.5, -0.5,
      0.5, -0.5,
      -0.5, 0.5,
      -0.5, 0.5,
      0.5, -0.5,
      0.5, 0.5,
    ]))
  }

  /**
   * 绑定覆盖整个屏幕的标准化 quad。
   *
   * 用于 present/composite 这种“直接采样整张纹理”的 pass。
   */
  bindFullscreenQuad(program: WebGLProgram): void {
    const location = this.gl.getAttribLocation(program, 'a_position')
    this.gl.bindBuffer(this.gl.ARRAY_BUFFER, this.fullscreenBuffer)
    this.gl.enableVertexAttribArray(location)
    this.gl.vertexAttribPointer(location, 2, this.gl.FLOAT, false, 0, 0)
  }

  /**
   * 绑定以原点为中心、边长为 1 的局部 quad。
   *
   * 用于 draw-source pass，由 vertex shader 负责把它缩放、旋转、平移到目标位置。
   */
  bindUnitQuad(program: WebGLProgram): void {
    const location = this.gl.getAttribLocation(program, 'a_position')
    this.gl.bindBuffer(this.gl.ARRAY_BUFFER, this.quadBuffer)
    this.gl.enableVertexAttribArray(location)
    this.gl.vertexAttribPointer(location, 2, this.gl.FLOAT, false, 0, 0)
  }

  /**
   * 释放 runtime 拥有的 GPU 资源。
   */
  dispose(): void {
    this.targets.clear()
    this.textures.clear()
    this.programs.dispose()
    this.gl.deleteBuffer(this.fullscreenBuffer)
    this.gl.deleteBuffer(this.quadBuffer)
  }

  /**
   * 创建一个静态顶点 buffer。
   */
  private createBuffer(data: Float32Array): WebGLBuffer {
    const buffer = this.gl.createBuffer()
    if (!buffer) {
      throw new Error('Failed to create WebGL buffer')
    }
    this.gl.bindBuffer(this.gl.ARRAY_BUFFER, buffer)
    this.gl.bufferData(this.gl.ARRAY_BUFFER, data, this.gl.STATIC_DRAW)
    return buffer
  }
}
