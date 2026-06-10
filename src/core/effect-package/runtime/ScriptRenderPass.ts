import { normalizePackageResourcePath } from '@/core/effect-package/manifest'
import type { LoadedEffectPackage } from '@/core/effect-package/types'
import { loadSampledResource } from '@/core/effect-package/runtime/sampledResourceLoader'
import { DrawPass, type DrawPassBlend, type UniformType } from '@/core/effect-package/script/DrawPass'
import type { RenderPassContext } from '@/core/webgl2/renderchain/RenderPassContext'
import type { TextureResource } from '@/core/webgl2/types'

export interface ScriptRenderPassIOContext {
  finalOutputTextureId: string
  passOutputTextureId: (passOutput: string) => string
  resolveInputTexture: (textureRef: string) => string | null
}

interface AttributeBufferEntry {
  buffer: WebGLBuffer
  version: number
}

export class ScriptRenderPass {
  private readonly attributeBuffers = new Map<string, AttributeBufferEntry>()
  private indexBuffer: { buffer: WebGLBuffer; version: number } | null = null

  constructor(
    private readonly loadedPackage: LoadedEffectPackage,
    private readonly drawPass: DrawPass,
  ) {}

  render(ctx: RenderPassContext, io: ScriptRenderPassIOContext): void {
    const gl = ctx.gl
    if (!this.drawPass.vertexShader || !this.drawPass.fragmentShader || !this.drawPass.output) {
      return
    }

    const outputTextureId =
      this.drawPass.output === 'final'
        ? io.finalOutputTextureId
        : io.passOutputTextureId(this.drawPass.output)
    const outputTarget = ctx.targets.ensureRenderTarget(outputTextureId, ctx.canvasWidth, ctx.canvasHeight)
    const program = ctx.runtime.programs.createProgram(
      this.drawPass.vertexShader,
      this.drawPass.fragmentShader,
    )

    gl.bindFramebuffer(gl.FRAMEBUFFER, outputTarget.framebuffer)
    if (this.drawPass.viewport === 'canvas') {
      gl.viewport(0, 0, outputTarget.width, outputTarget.height)
    } else {
      const viewport = this.drawPass.viewport
      gl.viewport(viewport.x, viewport.y, viewport.width, viewport.height)
    }

    if (this.drawPass.loadAction === 'clear') {
      gl.clearColor(...this.drawPass.clearColor)
      gl.clear(gl.COLOR_BUFFER_BIT)
    }

    this.applyBlend(gl, this.drawPass.blend)
    gl.useProgram(program)

    let vertexCount = 0
    for (const [name, attribute] of this.drawPass.attributes.entries()) {
      const location = gl.getAttribLocation(program, name)
      if (location < 0) {
        continue
      }

      let bufferEntry = this.attributeBuffers.get(name)
      if (!bufferEntry) {
        const buffer = gl.createBuffer()
        if (!buffer) {
          throw new Error(`创建 attribute buffer 失败: ${name}`)
        }
        bufferEntry = { buffer, version: -1 }
        this.attributeBuffers.set(name, bufferEntry)
      }

      gl.bindBuffer(gl.ARRAY_BUFFER, bufferEntry.buffer)
      if (bufferEntry.version !== attribute.version) {
        gl.bufferData(
          gl.ARRAY_BUFFER,
          attribute.data,
          attribute.usage === 'dynamic' ? gl.DYNAMIC_DRAW : gl.STATIC_DRAW,
        )
        bufferEntry.version = attribute.version
      }

      gl.enableVertexAttribArray(location)
      gl.vertexAttribPointer(location, attribute.size, gl.FLOAT, attribute.normalized, 0, 0)
      vertexCount = Math.max(vertexCount, attribute.data.length / attribute.size)
    }

    let activeTextureIndex = 0
    let hasIncompleteTextureBinding = false
    for (const [uniformName, binding] of this.drawPass.textures.entries()) {
      const textureId = io.resolveInputTexture(binding.textureRef)
      if (!textureId) {
        hasIncompleteTextureBinding = true
        break
      }

      let textureResource = ctx.textures.get(textureId)
      if (textureResource && !this.isDimensionCompatible(textureResource, binding.dimension)) {
        ctx.textures.remove(textureId)
        textureResource = null
      }

      if (!textureResource && binding.textureRef.startsWith('resource:')) {
        const normalizedPath = normalizePackageResourcePath(binding.textureRef.slice('resource:'.length))
        textureResource = this.resolvePackageTexture(ctx, textureId, normalizedPath, binding.dimension)
      }

      if (!textureResource) {
        hasIncompleteTextureBinding = true
        break
      }

      gl.activeTexture(gl.TEXTURE0 + activeTextureIndex)
      gl.bindTexture(textureResource.target === '3d' ? gl.TEXTURE_3D : gl.TEXTURE_2D, textureResource.texture)
      gl.uniform1i(gl.getUniformLocation(program, uniformName), activeTextureIndex)
      activeTextureIndex += 1
    }

    if (hasIncompleteTextureBinding) {
      return
    }

    for (const [uniformName, uniform] of this.drawPass.uniforms.entries()) {
      const location = gl.getUniformLocation(program, uniformName)
      if (location === null) {
        continue
      }

      this.applyUniform(gl, location, uniform.type, uniform.value)
    }

    if (this.drawPass.indices) {
      if (!this.indexBuffer) {
        const buffer = gl.createBuffer()
        if (!buffer) {
          throw new Error(`创建 index buffer 失败: ${this.drawPass.id}`)
        }
        this.indexBuffer = { buffer, version: -1 }
      }

      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.indexBuffer.buffer)
      if (this.indexBuffer.version !== this.drawPass.indices.version) {
        gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, this.drawPass.indices.data, gl.DYNAMIC_DRAW)
        this.indexBuffer.version = this.drawPass.indices.version
      }

      const indexType = this.drawPass.indices.data instanceof Uint32Array ? gl.UNSIGNED_INT : gl.UNSIGNED_SHORT
      gl.drawElements(this.resolveDrawMode(gl), this.drawPass.indices.data.length, indexType, 0)
      return
    }

    gl.drawArrays(this.resolveDrawMode(gl), 0, vertexCount)
  }

  dispose(gl: WebGL2RenderingContext): void {
    for (const entry of this.attributeBuffers.values()) {
      gl.deleteBuffer(entry.buffer)
    }
    this.attributeBuffers.clear()

    if (this.indexBuffer) {
      gl.deleteBuffer(this.indexBuffer.buffer)
      this.indexBuffer = null
    }
  }

  private resolvePackageTexture(
    ctx: RenderPassContext,
    textureId: string,
    resourcePath: string,
    dimension: '2d' | '3d',
  ): TextureResource | null {
    const resource = this.loadedPackage.sampledResources.get(resourcePath)
    if (resource) {
      if (dimension === '2d') {
        if (resource.kind !== 'image-2d') {
          throw new Error(`effect package 资源不是 2D 纹理: ${resourcePath}`)
        }

        return ctx.textures.uploadSource(
          textureId,
          resource.bitmap,
          resource.bitmap.width,
          resource.bitmap.height,
        )
      }

      if (resource.kind !== 'lut-3d') {
        throw new Error(`effect package 资源不是 3D LUT: ${resourcePath}`)
      }

      return ctx.textures.uploadData3D(
        textureId,
        resource.data,
        resource.size,
        resource.size,
        resource.size,
      )
    }

    const descriptor = this.loadedPackage.sampledResourceDescriptors.get(resourcePath)
    if (!descriptor) {
      throw new Error(`effect package 纹理资源不存在: ${resourcePath}`)
    }
    if (descriptor.dimension !== dimension) {
      throw new Error(`effect package 纹理维度不匹配: ${resourcePath}`)
    }

    void this.loadSampledPackageResource(resourcePath)
    return null
  }

  private async loadSampledPackageResource(resourcePath: string) {
    return loadSampledResource(this.loadedPackage, resourcePath)
      .catch((error) => {
        console.error(`[ScriptRenderPass] 加载纹理资源失败: ${resourcePath}`, error)
        return null
      })
  }

  private isDimensionCompatible(resource: TextureResource, dimension: '2d' | '3d'): boolean {
    return resource.target === dimension
  }

  private resolveDrawMode(gl: WebGL2RenderingContext): number {
    switch (this.drawPass.drawMode) {
      case 'triangle-strip':
        return gl.TRIANGLE_STRIP
      case 'lines':
        return gl.LINES
      case 'line-strip':
        return gl.LINE_STRIP
      case 'points':
        return gl.POINTS
      case 'triangles':
      default:
        return gl.TRIANGLES
    }
  }

  private applyBlend(gl: WebGL2RenderingContext, blend: DrawPassBlend): void {
    if (!blend.enabled) {
      gl.disable(gl.BLEND)
      return
    }

    gl.enable(gl.BLEND)
    gl.blendFuncSeparate(
      this.resolveBlendFactor(gl, blend.srcRGB ?? 'one'),
      this.resolveBlendFactor(gl, blend.dstRGB ?? 'zero'),
      this.resolveBlendFactor(gl, blend.srcAlpha ?? blend.srcRGB ?? 'one'),
      this.resolveBlendFactor(gl, blend.dstAlpha ?? blend.dstRGB ?? 'zero'),
    )
    gl.blendEquationSeparate(
      this.resolveBlendEquation(gl, blend.eqRGB ?? 'add'),
      this.resolveBlendEquation(gl, blend.eqAlpha ?? blend.eqRGB ?? 'add'),
    )
  }

  private resolveBlendFactor(gl: WebGL2RenderingContext, value: string): number {
    switch (value) {
      case 'zero':
        return gl.ZERO
      case 'src-alpha':
        return gl.SRC_ALPHA
      case 'one-minus-src-alpha':
        return gl.ONE_MINUS_SRC_ALPHA
      case 'dst-alpha':
        return gl.DST_ALPHA
      case 'one-minus-dst-alpha':
        return gl.ONE_MINUS_DST_ALPHA
      case 'src-color':
        return gl.SRC_COLOR
      case 'dst-color':
        return gl.DST_COLOR
      case 'one':
      default:
        return gl.ONE
    }
  }

  private resolveBlendEquation(gl: WebGL2RenderingContext, value: string): number {
    switch (value) {
      case 'subtract':
        return gl.FUNC_SUBTRACT
      case 'reverse-subtract':
        return gl.FUNC_REVERSE_SUBTRACT
      case 'add':
      default:
        return gl.FUNC_ADD
    }
  }

  private applyUniform(
    gl: WebGL2RenderingContext,
    location: WebGLUniformLocation,
    type: UniformType,
    value: unknown,
  ): void {
    switch (type) {
      case 'float':
        gl.uniform1f(location, Number(value ?? 0))
        break
      case 'int':
        gl.uniform1i(location, Math.round(Number(value ?? 0)))
        break
      case 'bool':
        gl.uniform1i(location, value ? 1 : 0)
        break
      case 'vec2':
        gl.uniform2fv(location, this.resolveVec2UniformValue(value))
        break
      case 'vec3':
        gl.uniform3fv(location, value as number[])
        break
      case 'vec4':
      case 'color4':
        gl.uniform4fv(location, value as number[])
        break
      case 'mat3':
        gl.uniformMatrix3fv(location, false, value as number[])
        break
      case 'mat4':
        gl.uniformMatrix4fv(location, false, value as number[])
        break
    }
  }

  private resolveVec2UniformValue(value: unknown): Float32List {
    if (Array.isArray(value) && value.length === 2) {
      const x = Number(value[0])
      const y = Number(value[1])
      if (!Number.isFinite(x) || !Number.isFinite(y)) {
        throw new Error('vec2 uniform value 数组必须包含有效数字')
      }
      return [x, y]
    }

    throw new Error('vec2 uniform value 必须是 [x, y]')
  }
}
