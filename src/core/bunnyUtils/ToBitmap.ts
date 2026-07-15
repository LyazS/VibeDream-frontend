import { toPng } from 'html-to-image'
import type { TextStyleConfig } from '@/core/timelineitem/model/textStyle'

/**
 * 将文本渲染为 ImageBitmap
 * @param text 文本内容
 * @param styleConfig 文本样式配置（使用 TextStyleConfig）
 * @returns Promise<ImageBitmap>
 */
export async function textToImageBitmap(
  text: string,
  styleConfig: TextStyleConfig,
): Promise<ImageBitmap> {
  if (!text) {
    throw new Error('text is empty')
  }

  const background = styleConfig.backgroundColor || 'transparent'
  const pixelRatio = Math.min(window.devicePixelRatio || 1, 2) // ✅ 防止超高 DPI OOM

  // ✅ 防坑 1：确保字体加载完成（否则 fallback）
  if (document.fonts?.ready) {
    await document.fonts.ready
  }

  // 如果有自定义字体，先加载
  if (styleConfig.customFont) {
    try {
      const fontFace = new FontFace(
        styleConfig.customFont.name,
        `url(${styleConfig.customFont.url})`,
      )
      await fontFace.load()
      document.fonts.add(fontFace)
    } catch (error) {
      console.warn('⚠️ [textToImageBitmap] 自定义字体加载失败，使用默认字体:', error)
    }
  }

  // ✅ 防坑 2：创建可测量、不可见、但可渲染的 DOM
  const el = document.createElement('div')
  el.textContent = text

  // 应用基础样式
  Object.assign(el.style, {
    position: 'fixed', // ✅ 不受父级影响
    left: '0',
    top: '0',
    transform: 'translate(-99999px, -99999px)', // ✅ 不用 display:none
    pointerEvents: 'none',
    userSelect: 'none',
    boxSizing: 'border-box',

    display: 'inline-block', // ✅ 防 inline 宽度 0
    whiteSpace: styleConfig.maxWidth ? 'normal' : 'pre',
    wordBreak: 'break-word',

    // 应用 TextStyleConfig 的样式
    fontFamily: styleConfig.customFont?.name || styleConfig.fontFamily,
    fontSize: `${styleConfig.fontSize}px`,
    fontWeight: String(styleConfig.fontWeight),
    fontStyle: styleConfig.fontStyle,
    lineHeight: styleConfig.lineHeight ? String(styleConfig.lineHeight) : '1.2',
    color: styleConfig.color,
    textAlign: styleConfig.textAlign,

    background,
  })

  // 应用最大宽度
  if (styleConfig.maxWidth) {
    el.style.maxWidth = `${styleConfig.maxWidth}px`
  }

  // 应用文本阴影
  if (styleConfig.textShadow) {
    el.style.textShadow = styleConfig.textShadow
  }

  // 应用文本描边
  if (styleConfig.textStroke) {
    el.style.webkitTextStroke = `${styleConfig.textStroke.width}px ${styleConfig.textStroke.color}`
  }

  // 应用文本发光效果
  if (styleConfig.textGlow) {
    const { color, blur, spread = 0 } = styleConfig.textGlow
    const glowShadows = [
      `0 0 ${blur}px ${color}`,
      `0 0 ${blur * 2}px ${color}`,
      `0 0 ${blur * 3}px ${color}`,
    ]
    if (spread > 0) {
      glowShadows.push(`0 0 ${spread}px ${color}`)
    }
    // 如果已有 textShadow，合并
    if (el.style.textShadow) {
      el.style.textShadow += ', ' + glowShadows.join(', ')
    } else {
      el.style.textShadow = glowShadows.join(', ')
    }
  }

  document.body.appendChild(el)

  // ✅ 防坑 3：强制布局计算（Safari / Chrome 差异）
  const rect = el.getBoundingClientRect()
  if (rect.width === 0 || rect.height === 0) {
    document.body.removeChild(el)
    throw new Error('Text layout failed: zero size')
  }

  // ✅ 防坑 4：避免 CSS transform / zoom 影响截图
  const style = window.getComputedStyle(el)
  const zoomBackup = style.zoom
  el.style.zoom = '1'

  try {
    // ✅ 防坑 5：DOM → PNG（高质量）
    const dataUrl = await toPng(el, {
      backgroundColor: background,
      pixelRatio,
      cacheBust: true, // ✅ 防缓存字体异常
      skipFonts: false,
    })

    // ✅ 防坑 6：释放 DOM
    document.body.removeChild(el)

    // ✅ 防坑 7：PNG → ImageBitmap（解码在后台线程）
    const blob = await (await fetch(dataUrl)).blob()

    const bitmap = await createImageBitmap(blob, {
      premultiplyAlpha: 'premultiply',
      colorSpaceConversion: 'default',
    })

    return bitmap
  } finally {
    // ✅ 防坑 8：恢复样式，避免污染
    el.style.zoom = zoomBackup
  }
}

/**
 * 现代 / 性能最优
 * Image File → ImageBitmap
 */
export async function fileToImageBitmap(
  file: File,
  options?: {
    maxPixels?: number // 防 OOM（默认开启）
    resizeWidth?: number // 可选：解码时缩放
    resizeHeight?: number
    resizeQuality?: ImageSmoothingQuality
  },
): Promise<ImageBitmap> {
  const {
    maxPixels = 4096 * 4096, // ✅ 防超大图内存炸
    resizeWidth,
    resizeHeight,
    resizeQuality = 'high',
  } = options ?? {}

  // ✅ 防坑 1：优先在解码阶段缩放（最省内存）
  const bitmap = await createImageBitmap(file, {
    resizeWidth,
    resizeHeight,
    resizeQuality,
  })

  // ✅ 防坑 2：解码成功但尺寸异常（极少数损坏图片）
  if (bitmap.width === 0 || bitmap.height === 0) {
    bitmap.close()
    throw new Error('Decoded bitmap has invalid size')
  }

  // ✅ 防坑 3：超大图兜底（防止后续 Canvas / WebGL 崩）
  if (bitmap.width * bitmap.height > maxPixels) {
    bitmap.close()
    throw new Error('Bitmap exceeds max pixel limit')
  }

  // ✅ 防坑 4：颜色 / Alpha 处理一致性（WebGL 友好）
  // 注意：createImageBitmap 已完成解码，此处只保证行为稳定
  return bitmap // ✅ CanvasImageSource
}

/**
 * 创建一个新的 HTML 元素
 * @param tagName - 要创建的元素的标签名
 * @returns 新创建的 HTML 元素
 */
function createEl(tagName: string): HTMLElement {
  return document.createElement(tagName)
}

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  let binary = ''
  const bytes = new Uint8Array(buffer)
  const len = bytes.byteLength
  for (let i = 0; i < len; i++) {
    binary += String.fromCharCode(bytes[i])
  }
  return window.btoa(binary)
}

/**
 * 将文本渲染为图片
 * @param txt - 要渲染的文本
 * @param cssText - 应用于文本的 CSS 样式
 * @returns 渲染后的图片元素
 */
async function renderTxt2Img(
  txt: string,
  cssText: string,
  opts: {
    font?: { name: string; url: string }
    onCreated?: (el: HTMLElement) => void
  } = {},
): Promise<HTMLImageElement> {
  const div = createEl('pre')
  div.style.cssText = `margin: 0; ${cssText}; position: fixed;`
  div.textContent = txt
  document.body.appendChild(div)
  opts.onCreated?.(div)

  const { width, height } = div.getBoundingClientRect()
  // 计算出 rect，立即从dom移除
  div.remove()

  const img = new Image()
  img.width = width
  img.height = height
  const fontFaceStr =
    opts.font == null
      ? ''
      : `
    @font-face {
      font-family: '${opts.font.name}';
      src: url('data:font/woff2;base64,${arrayBufferToBase64(await (await fetch(opts.font.url)).arrayBuffer())}') format('woff2');
    }
  `
  const svgStr = `
    <svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
      <style>
        ${fontFaceStr}
      </style>
      <foreignObject width="100%" height="100%">
        <div xmlns="http://www.w3.org/1999/xhtml">${div.outerHTML}</div>
      </foreignObject>
    </svg>
  `
    .replace(/\t/g, '')
    .replace(/#/g, '%23')

  img.src = `data:image/svg+xml;charset=utf-8,${svgStr}`

  await new Promise((resolve) => {
    img.onload = resolve
  })
  return img
}

/**
 * 将文本渲染为 ImageBitmap（使用 SVG + foreignObject 方式）
 * @param text - 要渲染的文本
 * @param styleConfig - 文本样式配置
 * @returns Promise<ImageBitmap>
 *
 * @example
 * ```typescript
 * const bitmap = await textToImageBitmap2(
 *   '水印',
 *   {
 *     fontSize: 40,
 *     fontFamily: 'Arial, sans-serif',
 *     color: 'white',
 *     textShadow: '2px 2px 6px red',
 *     customFont: {
 *       name: 'CustomFont',
 *       url: '/CustomFont.ttf',
 *     },
 *   },
 * )
 * ```
 */
export async function textToImageBitmap2(
  text: string,
  styleConfig: TextStyleConfig,
): Promise<ImageBitmap> {
  if (!text) {
    throw new Error('text is empty')
  }

  // 将 TextStyleConfig 转换为 CSS 字符串
  const cssParts: string[] = []

  // 基础字体属性
  cssParts.push(`font-size: ${styleConfig.fontSize}px`)
  cssParts.push(`font-family: ${styleConfig.customFont?.name || styleConfig.fontFamily}`)
  cssParts.push(`font-weight: ${styleConfig.fontWeight}`)
  cssParts.push(`font-style: ${styleConfig.fontStyle}`)

  // 颜色属性
  cssParts.push(`color: ${styleConfig.color}`)
  if (styleConfig.backgroundColor) {
    cssParts.push(`background-color: ${styleConfig.backgroundColor}`)
  }

  // 文本效果
  if (styleConfig.textShadow) {
    cssParts.push(`text-shadow: ${styleConfig.textShadow}`)
  }
  if (styleConfig.textStroke) {
    cssParts.push(`-webkit-text-stroke: ${styleConfig.textStroke.width}px ${styleConfig.textStroke.color}`)
  }
  if (styleConfig.textGlow) {
    const { color, blur, spread = 0 } = styleConfig.textGlow
    const glowShadows = [
      `0 0 ${blur}px ${color}`,
      `0 0 ${blur * 2}px ${color}`,
      `0 0 ${blur * 3}px ${color}`,
    ]
    if (spread > 0) {
      glowShadows.push(`0 0 ${spread}px ${color}`)
    }
    cssParts.push(`text-shadow: ${glowShadows.join(', ')}`)
  }

  // 布局属性
  cssParts.push(`text-align: ${styleConfig.textAlign}`)
  if (styleConfig.lineHeight) {
    cssParts.push(`line-height: ${styleConfig.lineHeight}`)
  }
  if (styleConfig.maxWidth) {
    cssParts.push(`max-width: ${styleConfig.maxWidth}px`)
  }

  const cssText = cssParts.join('; ')

  const imgEl = await renderTxt2Img(text, cssText, {
    font: styleConfig.customFont,
  })
  const cvs = new OffscreenCanvas(imgEl.width, imgEl.height)
  const ctx = cvs.getContext('2d')
  ctx?.drawImage(imgEl, 0, 0, imgEl.width, imgEl.height)
  return await createImageBitmap(cvs)
}
