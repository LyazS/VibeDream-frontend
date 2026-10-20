import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { createRenderer, h, nextTick, shallowReactive, type Component } from 'vue'
import MediaPreview from '../src/components/preview/MediaPreview.vue'
import MediaPreviewModal from '../src/components/modals/MediaPreviewModal.vue'
import type { MediaPreviewSource } from '../src/components/preview/mediaPreview'

const mocks = vi.hoisted(() => ({ getMediaItem: vi.fn() }))
vi.mock('@/core/unifiedStore', () => ({ useUnifiedStore: () => mocks }))
vi.mock('@/core/composables/useI18n', () => ({ useAppI18n: () => ({ t: (key: string) => key }) }))
// 遮罩的键盘和 Teleport 交互在浏览器验收；宿主测试覆盖真实预览组件的状态和资源生命周期。
vi.mock('@/components/modals/ModalOverlay.vue', () => ({
  default: {
    setup:
      (_props: unknown, { slots }: { slots: { default: () => unknown } }) =>
      () =>
        h('div', slots.default()),
  },
}))

class HostNode {
  props: Record<string, unknown> = {}
  children: HostNode[] = []
  parent: HostNode | null = null
  text = ''
  pause = vi.fn()
  context = { clearRect: vi.fn(), drawImage: vi.fn() }
  getContext = vi.fn(() => this.context)
  setPointerCapture = vi.fn()
  releasePointerCapture = vi.fn()
  getBoundingClientRect = () => ({ left: 0, top: 0, width: 1000, height: 600 })
  constructor(readonly type: string) {}
}
const renderer = createRenderer<HostNode, HostNode>({
  createElement: (type) => new HostNode(type),
  createText: () => new HostNode('#text'),
  createComment: () => new HostNode('#comment'),
  setText: (node, text) => {
    node.text = text
  },
  setElementText: (node, text) => {
    node.text = text
  },
  patchProp: (node, key, _old, value) => {
    node.props[key] = value
  },
  insert: (node, parent, anchor) => {
    if (node.parent) node.parent.children.splice(node.parent.children.indexOf(node), 1)
    node.parent = parent
    const index = anchor ? parent.children.indexOf(anchor) : -1
    parent.children.splice(index < 0 ? parent.children.length : index, 0, node)
  },
  remove: (node) => {
    node.parent?.children.splice(node.parent.children.indexOf(node), 1)
    node.parent = null
  },
  parentNode: (node) => node.parent,
  nextSibling: (node) => node.parent?.children[node.parent.children.indexOf(node) + 1] ?? null,
})
let app: ReturnType<typeof renderer.createApp>
let root: HostNode
function mount(component: Component, props: Record<string, unknown>) {
  root = new HostNode('root')
  app = renderer.createApp({ render: () => h(component, props) })
  app.mount(root)
}
function find(predicate: (node: HostNode) => boolean, node = root): HostNode | undefined {
  if (predicate(node)) return node
  for (const child of node.children) {
    const result = find(predicate, child)
    if (result) return result
  }
}
function fire(node: HostNode, name: string, event: Record<string, unknown> = {}) {
  ;(node.props[name] as (event: unknown) => void)({
    currentTarget: node,
    preventDefault: vi.fn(),
    stopPropagation: vi.fn(),
    ...event,
  })
}
async function mountImage(kind: 'blob' | 'bitmap') {
  mount(MediaPreview, {
    show: true,
    source:
      kind === 'blob'
        ? source()
        : {
            type: 'image',
            bitmap: { width: 1200, height: 800, close: vi.fn() },
            name: 'bitmap',
          },
  })
  await nextTick()
  const image = find((node) => node.type === (kind === 'blob' ? 'img' : 'canvas'))!
  if (kind === 'blob') fire(image, 'onLoad')
  await nextTick()
  return { image, stage: find((node) => node.props.class === 'preview-stage')! }
}
function wheel(stage: HostNode, event: Record<string, unknown>) {
  fire(stage, 'onWheel', {
    deltaX: 0,
    deltaY: 0,
    deltaMode: 0,
    clientX: 600,
    clientY: 350,
    ...event,
  })
}
function imageTransform(image: HostNode) {
  const transform = (image.props.style as { transform: string }).transform
  const values = transform.match(/translate\((.*)px, (.*)px\) scale\((.*)\)/)!
  return { x: Number(values[1]), y: Number(values[2]), zoom: Number(values[3]) }
}
function source(type: MediaPreviewSource['type'] = 'image') {
  return {
    type,
    blob: new Blob(['file'], { type: `${type}/${type === 'image' ? 'png' : 'webm'}` }),
    name: `sample.${type}`,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  let count = 0
  vi.spyOn(URL, 'createObjectURL').mockImplementation(() => `blob:preview-${++count}`)
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
})
afterEach(() => {
  app?.unmount()
  vi.restoreAllMocks()
})

it('allocates only while open and releases URLs on source changes, close, and unmount', async () => {
  const props = shallowReactive({ show: false, source: source() })
  mount(MediaPreview, props)
  expect(URL.createObjectURL).not.toHaveBeenCalled()
  props.show = true
  await nextTick()
  expect(find((node) => node.type === 'img')?.props.src).toBe('blob:preview-1')
  props.source = source('video')
  await nextTick()
  expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:preview-1')
  const player = find((node) => node.type === 'video')!
  props.show = false
  await nextTick()
  expect(player.pause).toHaveBeenCalledOnce()
  expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:preview-2')
  props.show = true
  await nextTick()
  app.unmount()
  expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:preview-3')
})

it.each(['video', 'audio'] as const)(
  'uses native %s playback and reports decoding errors',
  async (type) => {
    mount(MediaPreview, { show: true, source: source(type) })
    const player = find((node) => node.type === type)!
    expect(player.props.controls).toBeDefined()
    expect(player.props.autoplay).toBeDefined()
    fire(player, 'onError')
    await nextTick()
    expect(
      find((node) => node.props.role === 'alert')?.children.some(
        (node) => node.text === 'media.preview.loadFailed',
      ),
    ).toBe(true)
    expect(find((node) => node.type === type)).toBeUndefined()
  },
)

it('zooms, drags with pointer capture, and resets images', async () => {
  mount(MediaPreview, { show: true, source: source() })
  const image = find((node) => node.type === 'img')!
  fire(image, 'onLoad')
  await nextTick()
  fire(find((node) => node.props['aria-label'] === 'media.preview.zoomIn')!, 'onClick')
  await nextTick()
  expect(image.props.style).toMatchObject({ transform: 'translate(0px, 0px) scale(1.2)' })
  fire(image, 'onPointerdown', {
    button: 0,
    pointerId: 1,
    clientX: 0,
    clientY: 0,
    preventDefault() {},
  })
  fire(image, 'onPointermove', { pointerId: 1, clientX: 20, clientY: 30 })
  fire(image, 'onPointerup', { pointerId: 1 })
  await nextTick()
  expect(image.setPointerCapture).toHaveBeenCalledWith(1)
  expect(image.releasePointerCapture).toHaveBeenCalledWith(1)
  expect(image.props.style).toMatchObject({ transform: 'translate(20px, 30px) scale(1.2)' })
  fire(find((node) => node.props['aria-label'] === 'media.preview.resetZoom')!, 'onClick')
  await nextTick()
  expect(image.props.style).toMatchObject({ transform: 'translate(0px, 0px) scale(1)' })
})

it('emits close exactly once from the close button', () => {
  const onClose = vi.fn()
  const onUpdate = vi.fn()
  mount(MediaPreview, { show: true, source: source(), onClose, 'onUpdate:show': onUpdate })
  fire(find((node) => node.props['aria-label'] === 'common.close')!, 'onClick')
  expect(onClose).toHaveBeenCalledOnce()
  expect(onUpdate).toHaveBeenCalledExactlyOnceWith(false)
})

it.each(['blob', 'bitmap'] as const)(
  'pans %s images with two-finger scrolling, including fast and inertial deltas',
  async (kind) => {
    const { image, stage } = await mountImage(kind)
    const preventDefault = vi.fn()
    const stopPropagation = vi.fn()
    wheel(stage, { deltaX: 12, deltaY: 30, preventDefault, stopPropagation })
    wheel(stage, { deltaX: 120, deltaY: 250 })
    await nextTick()
    expect(imageTransform(image)).toEqual({ x: -132, y: -280, zoom: 1 })
    expect(preventDefault).toHaveBeenCalledOnce()
    expect(stopPropagation).toHaveBeenCalledOnce()
  },
)

it.each(['blob', 'bitmap'] as const)(
  'zooms %s images around the pointer for pinch and modifier-wheel input',
  async (kind) => {
    const { image, stage } = await mountImage(kind)
    for (const key of ['ctrlKey', 'metaKey', 'altKey']) {
      fire(image, 'onDblclick')
      wheel(stage, { [key]: true, deltaY: -50 })
      await nextTick()
      const { x, y, zoom } = imageTransform(image)
      expect(zoom).toBeCloseTo(Math.exp(0.18))
      // 缩放前后鼠标下的图像坐标保持不变。
      expect((100 - x) / zoom).toBeCloseTo(100)
      expect((50 - y) / zoom).toBeCloseTo(50)
    }
  },
)

it('normalizes line/page wheels and supports Shift-wheel horizontal panning', async () => {
  const { image, stage } = await mountImage('blob')
  wheel(stage, { deltaY: 3, deltaMode: 1 })
  wheel(stage, { deltaY: 1, deltaMode: 2 })
  wheel(stage, { deltaY: 40, shiftKey: true })
  await nextTick()
  expect(imageTransform(image)).toEqual({ x: -40, y: -648, zoom: 1 })
})

it('supports middle-button dragging, suppresses wheel transforms during drag, and resets on double-click', async () => {
  const { image, stage } = await mountImage('bitmap')
  fire(image, 'onPointerdown', { button: 1, pointerId: 2, clientX: 10, clientY: 20 })
  fire(image, 'onPointermove', { pointerId: 2, clientX: 60, clientY: 90 })
  wheel(stage, { deltaY: 60, ctrlKey: true })
  fire(image, 'onPointerup', { pointerId: 2 })
  await nextTick()
  expect(imageTransform(image)).toEqual({ x: 50, y: 70, zoom: 1 })
  fire(image, 'onDblclick')
  await nextTick()
  expect(imageTransform(image)).toEqual({ x: 0, y: 0, zoom: 1 })
})

it.each(['video', 'audio'] as const)('preserves native %s wheel behavior', async (type) => {
  mount(MediaPreview, { show: true, source: source(type) })
  const preventDefault = vi.fn()
  const stopPropagation = vi.fn()
  wheel(find((node) => node.props.class === 'preview-stage')!, {
    deltaY: 30,
    preventDefault,
    stopPropagation,
  })
  expect(preventDefault).not.toHaveBeenCalled()
  expect(stopPropagation).not.toHaveBeenCalled()
})

it.each(['video', 'audio'] as const)(
  'adapts original library %s files into the common preview',
  (type) => {
    const blob = source(type).blob
    const getOriFile = vi.fn(() => blob)
    mocks.getMediaItem.mockReturnValue({
      mediaType: type,
      mediaStatus: 'ready',
      duration: 1,
      name: 'library file',
      runtime: { bunny: { bunnyMedia: { getOriFile } } },
    })
    mount(MediaPreviewModal, { show: true, mediaItemId: 'asset' })
    expect(getOriFile).toHaveBeenCalledOnce()
    expect(URL.createObjectURL).toHaveBeenCalledWith(blob)
    expect(find((node) => node.type === type)).toBeDefined()
  },
)

it('previews library images that only have imageClip without closing the shared bitmap', async () => {
  const bitmap = { width: 1200, height: 800, close: vi.fn() }
  mocks.getMediaItem.mockReturnValue({
    mediaType: 'image',
    mediaStatus: 'ready',
    duration: 150,
    name: 'library image',
    runtime: { bunny: { imageClip: bitmap } },
  })
  const props = shallowReactive({ show: true, mediaItemId: 'image' })
  mount(MediaPreviewModal, props)
  await nextTick()
  const canvas = find((node) => node.type === 'canvas')!
  expect(canvas.props.width).toBe(1200)
  expect(canvas.props.height).toBe(800)
  expect(canvas.context.drawImage).toHaveBeenCalledWith(bitmap, 0, 0)
  expect(find((node) => node.props.role === 'alert')).toBeUndefined()
  expect(find((node) => node.props.role === 'status')).toBeUndefined()
  expect(URL.createObjectURL).not.toHaveBeenCalled()
  fire(find((node) => node.props['aria-label'] === 'media.preview.zoomIn')!, 'onClick')
  await nextTick()
  expect(canvas.props.style).toMatchObject({ transform: 'translate(0px, 0px) scale(1.2)' })
  props.show = false
  await nextTick()
  app.unmount()
  expect(bitmap.close).not.toHaveBeenCalled()
})

it('switches between library bitmaps and Agent blobs without closing the shared bitmap', async () => {
  const bitmap = { width: 1200, height: 800, close: vi.fn() } as unknown as ImageBitmap
  const props = shallowReactive<{ show: boolean; source: MediaPreviewSource }>({
    show: true,
    source: { type: 'image', bitmap, name: 'old bitmap' },
  })
  mount(MediaPreview, props)
  await nextTick()
  const canvas = find((node) => node.type === 'canvas')!
  props.source = source()
  await nextTick()
  await nextTick()
  expect(canvas.context.drawImage).toHaveBeenCalledOnce()
  expect(find((node) => node.type === 'img')?.props.src).toBe('blob:preview-1')
  props.source = { type: 'image', bitmap, name: 'same bitmap' }
  await nextTick()
  await nextTick()
  expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:preview-1')
  expect(find((node) => node.type === 'canvas')?.context.drawImage).toHaveBeenCalledWith(
    bitmap,
    0,
    0,
  )
  expect(bitmap.close).not.toHaveBeenCalled()
})

it('discards a pending bitmap draw after unmount', async () => {
  const bitmap = { width: 1200, height: 800, close: vi.fn() } as unknown as ImageBitmap
  mount(MediaPreview, { show: true, source: { type: 'image', bitmap, name: 'bitmap' } })
  const canvas = find((node) => node.type === 'canvas')!
  app.unmount()
  await nextTick()
  expect(canvas.context.drawImage).not.toHaveBeenCalled()
  expect(bitmap.close).not.toHaveBeenCalled()
})

it('does not read hidden library files and handles released audio/video originals', async () => {
  const getOriFile = vi.fn(() => {
    throw new Error('released')
  })
  mocks.getMediaItem.mockReturnValue({
    mediaType: 'video',
    mediaStatus: 'ready',
    duration: 1,
    name: 'released',
    runtime: { bunny: { bunnyMedia: { getOriFile } } },
  })
  const props = shallowReactive({ show: false, mediaItemId: 'asset' })
  mount(MediaPreviewModal, props)
  expect(mocks.getMediaItem).not.toHaveBeenCalled()
  props.show = true
  await nextTick()
  expect(find((node) => node.props.role === 'alert')).toBeDefined()
  expect(URL.createObjectURL).not.toHaveBeenCalled()
})
