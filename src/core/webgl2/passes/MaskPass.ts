import type {
  EllipseMaskConfig,
  MaskConfig,
  MirrorMaskConfig,
  RectangleMaskConfig,
} from '@/core/timelineitem/features/mask'
import { resolveMaskPixelGeometry } from '@/core/timelineitem/features/mask'
import type { RenderPass } from '@/core/webgl2/renderchain/RenderPass'
import type { RenderPassContext } from '@/core/webgl2/renderchain/RenderPassContext'
import type { ProgramManager } from '@/core/webgl2/runtime/ProgramManager'
import type { RenderTargetPool } from '@/core/webgl2/runtime/RenderTargetPool'
import MASK_ELLIPSE_FRAGMENT_SHADER from '@/core/webgl2/shaders/mask-ellipse.frag?raw'
import MASK_LINEAR_FRAGMENT_SHADER from '@/core/webgl2/shaders/mask-linear.frag?raw'
import MASK_MIRROR_FRAGMENT_SHADER from '@/core/webgl2/shaders/mask-mirror.frag?raw'
import MASK_RECTANGLE_FRAGMENT_SHADER from '@/core/webgl2/shaders/mask-rectangle.frag?raw'
import MASK_VERTEX_SHADER from '@/core/webgl2/shaders/mask.vert?raw'

type ProgramEntry = {
  program: WebGLProgram
  bindShapeUniforms: (gl: WebGL2RenderingContext, program: WebGLProgram, mask: MaskConfig) => void
}

export class MaskPass implements RenderPass {
  readonly id: string
  private readonly programsByType: Record<MaskConfig['type'], ProgramEntry>

  constructor(
    id: string,
    programs: Pick<ProgramManager, 'createProgram'>,
    private readonly inputTextureId: string,
    private readonly outputTextureId: string,
    private readonly targets: Pick<RenderTargetPool, 'releaseRenderTarget'>,
    private readonly getMaskConfig: () => MaskConfig | undefined,
  ) {
    this.id = id
    this.programsByType = {
      rectangle: {
        program: programs.createProgram(MASK_VERTEX_SHADER, MASK_RECTANGLE_FRAGMENT_SHADER),
        bindShapeUniforms: (gl, program, mask) => {
          const rectangleMask = mask as RectangleMaskConfig
          const cornerRadiusPixels =
            Math.min(rectangleMask.width, rectangleMask.height) * 0.5 * rectangleMask.cornerRadius
          gl.uniform2f(
            gl.getUniformLocation(program, 'u_rectSize'),
            rectangleMask.width,
            rectangleMask.height,
          )
          gl.uniform1f(
            gl.getUniformLocation(program, 'u_cornerRadius'),
            cornerRadiusPixels,
          )
        },
      },
      ellipse: {
        program: programs.createProgram(MASK_VERTEX_SHADER, MASK_ELLIPSE_FRAGMENT_SHADER),
        bindShapeUniforms: (gl, program, mask) => {
          const ellipseMask = mask as EllipseMaskConfig
          gl.uniform2f(
            gl.getUniformLocation(program, 'u_ellipseSize'),
            ellipseMask.ellipseWidth,
            ellipseMask.ellipseHeight,
          )
        },
      },
      linear: {
        program: programs.createProgram(MASK_VERTEX_SHADER, MASK_LINEAR_FRAGMENT_SHADER),
        bindShapeUniforms: () => {},
      },
      mirror: {
        program: programs.createProgram(MASK_VERTEX_SHADER, MASK_MIRROR_FRAGMENT_SHADER),
        bindShapeUniforms: (gl, program, mask) => {
          const mirrorMask = mask as MirrorMaskConfig
          gl.uniform1f(gl.getUniformLocation(program, 'u_length'), mirrorMask.length)
        },
      },
    }
  }

  render(ctx: RenderPassContext): void {
    const input = ctx.textures.get(this.inputTextureId)
    if (!input) return

    const mask = this.getMaskConfig()
    if (!mask?.enabled) return

    const pixelGeometry = resolveMaskPixelGeometry(mask, {
      width: input.width,
      height: input.height,
    })
    const output = ctx.targets.ensureRenderTarget(this.outputTextureId, input.width, input.height)
    const gl = ctx.gl
    const entry = this.programsByType[pixelGeometry.type]
    const program = entry.program

    gl.bindFramebuffer(gl.FRAMEBUFFER, output.framebuffer)
    gl.viewport(0, 0, output.width, output.height)
    gl.clearColor(0, 0, 0, 0)
    gl.clear(gl.COLOR_BUFFER_BIT)
    gl.useProgram(program)
    ctx.runtime.bindFullscreenQuad(program)

    gl.activeTexture(gl.TEXTURE0)
    gl.bindTexture(gl.TEXTURE_2D, input.texture)
    gl.uniform1i(gl.getUniformLocation(program, 'u_source'), 0)
    gl.uniform2f(gl.getUniformLocation(program, 'u_textureSize'), input.width, input.height)
    gl.uniform2f(gl.getUniformLocation(program, 'u_center'), pixelGeometry.centerX, pixelGeometry.centerY)
    gl.uniform1f(gl.getUniformLocation(program, 'u_rotation'), (pixelGeometry.rotation * Math.PI) / 180)
    gl.uniform1f(gl.getUniformLocation(program, 'u_outerRange'), pixelGeometry.falloff.outerRange)
    gl.uniform1f(gl.getUniformLocation(program, 'u_decayRate'), pixelGeometry.falloff.decayRate)
    gl.uniform1i(gl.getUniformLocation(program, 'u_inverted'), pixelGeometry.inverted ? 1 : 0)
    entry.bindShapeUniforms(gl, program, pixelGeometry)
    gl.drawArrays(gl.TRIANGLES, 0, 6)
  }

  dispose(): void {
    this.targets.releaseRenderTarget(this.outputTextureId)
  }
}
