import type { MainRenderTarget } from '@/core/webgl2/types'
import { WebGL2Runtime } from '@/core/webgl2/runtime/WebGL2Runtime'
import { TextureManager } from '@/core/webgl2/runtime/TextureManager'
import { RenderTargetPool } from '@/core/webgl2/runtime/RenderTargetPool'

/**
 * 单个 pass 执行时可见的运行时上下文。
 *
 * 设计原则：
 * - pass 只依赖渲染层，不依赖 `UnifiedMediaBunnyModule`
 * - 所有共享资源都通过 context 显式传入，便于测试和后续扩展
 */
export interface RenderPassContext {
  gl: WebGL2RenderingContext
  runtime: WebGL2Runtime
  textures: TextureManager
  targets: RenderTargetPool
  frame: number
  canvasWidth: number
  canvasHeight: number
  mainTarget: MainRenderTarget
}
