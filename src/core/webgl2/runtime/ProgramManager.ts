/**
 * 负责 shader program 的编译与缓存。
 *
 * 设计目标：
 * - 上层只关心 “用哪组 shader 源码拿 program”，不关心编译细节
 * - program 首次使用时延迟创建，避免初始化阶段做不必要的 GPU 工作
 * - 当 WebGLRuntime 销毁时统一释放 program
 */
export class ProgramManager {
  private readonly programs = new Map<string, WebGLProgram>()

  constructor(private readonly gl: WebGL2RenderingContext) {}

  /**
   * 获取或创建一个已编译的 program。
   *
   * 缓存键由顶点/片元源码组合得到；同一组源码只编译链接一次。
   */
  createProgram(vertexSource: string, fragmentSource: string): WebGLProgram {
    const cacheKey = this.getCacheKey(vertexSource, fragmentSource)
    const existing = this.programs.get(cacheKey)
    if (existing) return existing

    const created = this.linkProgram(vertexSource, fragmentSource)
    this.programs.set(cacheKey, created)
    return created
  }

  dispose(): void {
    for (const program of this.programs.values()) {
      this.gl.deleteProgram(program)
    }
    this.programs.clear()
  }

  private getCacheKey(vertexSource: string, fragmentSource: string): string {
    return `vert:${vertexSource}\n__LC_PROGRAM_SPLIT__\nfrag:${fragmentSource}`
  }

  /**
   * 编译 vertex/fragment，并链接成一个可执行 program。
   *
   * 这里对 shader 生命周期采取“编译后立即释放 shader object”的常规做法，
   * 因为链接成功后 program 已拥有内部副本，不需要再保留中间 shader。
   */
  private linkProgram(vertexSource: string, fragmentSource: string): WebGLProgram {
    const vertexShader = this.compileShader(this.gl.VERTEX_SHADER, vertexSource)
    const fragmentShader = this.compileShader(this.gl.FRAGMENT_SHADER, fragmentSource)
    const program = this.gl.createProgram()

    if (!program) {
      throw new Error('Failed to create WebGL program')
    }

    this.gl.attachShader(program, vertexShader)
    this.gl.attachShader(program, fragmentShader)
    this.gl.linkProgram(program)

    if (!this.gl.getProgramParameter(program, this.gl.LINK_STATUS)) {
      const message = this.gl.getProgramInfoLog(program) || 'Unknown WebGL program link error'
      this.gl.deleteProgram(program)
      this.gl.deleteShader(vertexShader)
      this.gl.deleteShader(fragmentShader)
      throw new Error(message)
    }

    this.gl.deleteShader(vertexShader)
    this.gl.deleteShader(fragmentShader)

    return program
  }

  /**
   * 编译单个 shader；失败时直接抛出源码对应的编译错误。
   */
  private compileShader(type: number, source: string): WebGLShader {
    const shader = this.gl.createShader(type)
    if (!shader) {
      throw new Error('Failed to create WebGL shader')
    }

    this.gl.shaderSource(shader, source)
    this.gl.compileShader(shader)

    if (!this.gl.getShaderParameter(shader, this.gl.COMPILE_STATUS)) {
      const message = this.gl.getShaderInfoLog(shader) || 'Unknown WebGL shader compile error'
      this.gl.deleteShader(shader)
      throw new Error(message)
    }

    return shader
  }
}
