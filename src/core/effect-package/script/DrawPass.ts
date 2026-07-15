export type DrawPassMode = 'triangles' | 'triangle-strip' | 'lines' | 'line-strip' | 'points'
export type DrawPassViewport = 'canvas' | { x: number; y: number; width: number; height: number }
export type DrawPassLoadAction = 'load' | 'clear'
export type UniformType =
  | 'float'
  | 'int'
  | 'bool'
  | 'vec2'
  | 'ivec2'
  | 'vec3'
  | 'vec4'
  | 'color4'
  | 'mat3'
  | 'mat4'

export interface DrawPassAttribute {
  size: 1 | 2 | 3 | 4
  data: Float32Array
  normalized: boolean
  usage: 'static' | 'dynamic'
  version: number
}

export interface DrawPassUniform {
  type: UniformType
  value: unknown
}

export type DrawPassTextureDimension = '2d' | '3d'

export interface DrawPassTextureBinding {
  textureRef: string
  dimension: DrawPassTextureDimension
}

export interface DrawPassBlend {
  enabled: boolean
  srcRGB?: string
  dstRGB?: string
  srcAlpha?: string
  dstAlpha?: string
  eqRGB?: string
  eqAlpha?: string
}

function toFloat32Array(data: ArrayLike<number>): Float32Array {
  return data instanceof Float32Array ? data : new Float32Array(Array.from(data))
}

function toIndexArray(data: ArrayLike<number>): Uint16Array | Uint32Array {
  const values = Array.from(data, (value) => Math.max(0, Math.round(Number(value) || 0)))
  const max = values.reduce((current, value) => Math.max(current, value), 0)
  return max > 65535 ? new Uint32Array(values) : new Uint16Array(values)
}

export class DrawPass {
  readonly id: string
  vertexShader = ''
  fragmentShader = ''
  output = ''
  drawMode: DrawPassMode = 'triangles'
  viewport: DrawPassViewport = 'canvas'
  loadAction: DrawPassLoadAction = 'load'
  clearColor: [number, number, number, number] = [0, 0, 0, 0]
  blend: DrawPassBlend = { enabled: false }
  readonly attributes = new Map<string, DrawPassAttribute>()
  indices: { data: Uint16Array | Uint32Array; version: number } | null = null
  readonly textures = new Map<string, DrawPassTextureBinding>()
  readonly uniforms = new Map<string, DrawPassUniform>()

  private phase: 'init' | 'update' = 'init'

  constructor(id: string) {
    this.id = id
  }

  enterUpdatePhase(): void {
    this.phase = 'update'
  }

  setVertexShader(source: string): void {
    this.assertInitOnly('setVertexShader')
    this.vertexShader = source
  }

  setFragmentShader(source: string): void {
    this.assertInitOnly('setFragmentShader')
    this.fragmentShader = source
  }

  setOutput(outputName: string): void {
    this.assertInitOnly('setOutput')
    this.output = outputName
  }

  setDrawMode(mode: DrawPassMode): void {
    this.drawMode = mode
  }

  setViewport(viewport: DrawPassViewport): void {
    this.viewport = viewport
  }

  addAttribute(
    name: string,
    config: {
      size: 1 | 2 | 3 | 4
      data: ArrayLike<number>
      normalized?: boolean
      usage?: 'static' | 'dynamic'
    },
  ): void {
    this.assertInitOnly('addAttribute')
    this.attributes.set(name, {
      size: config.size,
      data: toFloat32Array(config.data),
      normalized: Boolean(config.normalized),
      usage: config.usage ?? 'static',
      version: 0,
    })
  }

  updateAttribute(name: string, data: ArrayLike<number>): void {
    this.assertDynamicMutationAllowed()
    const attribute = this.attributes.get(name)
    if (!attribute) {
      throw new Error(`DrawPass attribute 不存在: ${name}`)
    }

    attribute.data = toFloat32Array(data)
    attribute.version += 1
  }

  setIndices(data: ArrayLike<number>): void {
    this.indices = {
      data: toIndexArray(data),
      version: 0,
    }
  }

  updateIndices(data: ArrayLike<number>): void {
    this.assertDynamicMutationAllowed()
    if (!this.indices) {
      throw new Error('DrawPass indices 尚未初始化')
    }

    this.indices.data = toIndexArray(data)
    this.indices.version += 1
  }

  addTexture(
    uniformName: string,
    textureRef: string,
    config?: { dimension?: DrawPassTextureDimension },
  ): void {
    this.assertInitOnly('addTexture')
    this.textures.set(uniformName, {
      textureRef,
      dimension: config?.dimension ?? '2d',
    })
  }

  setTexture(
    uniformName: string,
    textureRef: string,
    config?: { dimension?: DrawPassTextureDimension },
  ): void {
    this.assertDynamicMutationAllowed()
    const existing = this.textures.get(uniformName)
    if (!existing) {
      throw new Error(`DrawPass texture uniform 不存在: ${uniformName}`)
    }

    this.textures.set(uniformName, {
      textureRef,
      dimension: config?.dimension ?? existing.dimension,
    })
  }

  addUniform(uniformName: string, type: UniformType, value: unknown): void {
    this.assertInitOnly('addUniform')
    this.uniforms.set(uniformName, { type, value })
  }

  setUniform(uniformName: string, value: unknown): void {
    this.assertDynamicMutationAllowed()
    const uniform = this.uniforms.get(uniformName)
    if (!uniform) {
      throw new Error(`DrawPass uniform 不存在: ${uniformName}`)
    }

    uniform.value = value
  }

  setBlend(config: DrawPassBlend): void {
    this.blend = { ...config }
  }

  setLoadAction(action: DrawPassLoadAction): void {
    this.loadAction = action
  }

  setClearColor(color: [number, number, number, number]): void {
    this.clearColor = color
  }

  private assertInitOnly(methodName: string): void {
    if (this.phase !== 'init') {
      throw new Error(`${methodName} 只允许在 init() 阶段调用`)
    }
  }

  private assertDynamicMutationAllowed(): void {
    // Uniform/texture/index/attribute value updates are safe both before and after the
    // pass becomes live. Keep the stricter phase gate only for structural init-only APIs.
    if (this.phase !== 'init' && this.phase !== 'update') {
      throw new Error('当前 DrawPass 状态不允许修改动态数据')
    }
  }
}
