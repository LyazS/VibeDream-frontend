import type { VideoSample } from 'mediabunny'

/**
 * WebGL2 渲染层共享类型。
 *
 * 这里刻意只保留跨模块流转的最小结构：
 * - texture/resource：可被 shader 读取的 GPU 资源
 * - render target：可被 framebuffer 写入的离屏目标
 * - main target：主画面的 ping-pong 双缓冲
 * - uniforms：item 合成到主画面时需要的几何参数
 */
export interface TextureResource {
  id: string
  texture: WebGLTexture
  target: '2d' | '3d'
  width: number
  height: number
  depth?: number
}

/**
 * MediaBunny 解码后、在预览/导出间共享的当前帧数据。
 */
export interface FrameData {
  frameNumber: number
  videoSample: VideoSample
  clockwiseRotation: number
}

/**
 * 单个离屏渲染目标。
 *
 * 约束：
 * - `textureId` 必须能在 `TextureManager` 中查回同一张 texture
 * - framebuffer 与 texture 一一对应
 * - 第一阶段 item target 是短生命周期对象，main target 是长生命周期对象
 */
export interface RenderTarget {
  framebuffer: WebGLFramebuffer
  textureId: string
  texture: WebGLTexture
  width: number
  height: number
}

/**
 * 主画面专用的 ping-pong target。
 *
 * 语义约定：
 * - `swapMainTarget()` 后，`read` 表示当前 composite 要读取的主画面底图
 * - `write` 表示当前 composite 的写入目标，且在 swap 时已先复制过一份完整底图
 * - 当前 composite 结束后，最新完整结果保存在 `write`
 */
export interface MainRenderTarget {
  read: RenderTarget
  write: RenderTarget
}

/**
 * CompositeToMainPass 所需的最小几何参数。
 *
 * 坐标系约定：
 * - x/y 以画布中心为原点
 * - y > 0 表示向上
 * - rotationRadians 已做过符号补偿，以保持现有用户旋转体感
 */
export interface DrawSourceUniforms {
  x: number
  y: number
  rotationRadians: number
  blendIntensity: number
}
