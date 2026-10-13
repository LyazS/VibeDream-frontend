import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { createRenderer, nextTick, reactive } from 'vue'
import AgentInput from '../src/components/agent/AgentInput.vue'
import type { AgentImage } from '../src/core/agent/types'

const mocks = vi.hoisted(() => ({
  store: {
    agentReady: true,
    agentBusy: false,
    agentRunning: false,
    sendAgentMessage: vi.fn(),
    stopAgent: vi.fn(),
  },
  processImage: vi.fn(),
  disposePreview: vi.fn(),
}))
vi.mock('@/core/unifiedStore', () => ({ useUnifiedStore: () => mocks.store }))
vi.mock('@/core/composables/useI18n', () => ({ useAppI18n: () => ({ t: (key: string) => key }) }))
vi.mock('@/constants/iconComponents', () => ({
  IconComponents: { CLOSE: 'span', IMAGE_SMALL: 'span', STOP: 'span', SEND: 'span' },
}))
vi.mock('naive-ui', () => ({ NImage: { render: () => null } }))
vi.mock('../src/components/agent/AgentUsageIndicator.vue', () => ({
  default: { render: () => null },
}))
vi.mock('@/core/agent/services/agentImageService', () => ({
  AGENT_IMAGE_LIMITS: { count: 4 },
  processAgentImage: mocks.processImage,
  createAgentImagePreview: () => ({ url: 'blob:preview', dispose: mocks.disposePreview }),
}))

// Mount the actual component with Vue's host renderer, without a browser dependency.
class HostNode {
  props: Record<string, unknown> = {}
  children: HostNode[] = []
  parent: HostNode | null = null
  value = ''
  constructor(readonly type: string) {}
  addEventListener() {}
  getRootNode() {
    return null
  }
}
const renderer = createRenderer<HostNode, HostNode>({
  createElement: (type) => new HostNode(type),
  createText: () => new HostNode('#text'),
  createComment: () => new HostNode('#comment'),
  setText: () => {},
  setElementText: () => {},
  patchProp: (node, key, _previous, value) => {
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
let root: HostNode
let app: ReturnType<typeof renderer.createApp>
function findNode(predicate: (node: HostNode) => boolean, node = root): HostNode {
  const found = findOptional(predicate, node)
  if (found) return found
  throw new Error('Component node not found')
}
function findOptional(
  predicate: (node: HostNode) => boolean,
  node: HostNode,
): HostNode | undefined {
  if (predicate(node)) return node
  for (const child of node.children) {
    const found = findOptional(predicate, child)
    if (found) return found
  }
}
const sendButton = () => findNode((node) => node.props.class === 'chat-send-button')
const textarea = () => findNode((node) => node.type === 'textarea')
const image = (id: string): AgentImage => ({
  id,
  blob: new Blob([id], { type: 'image/webp' }),
  mimeType: 'image/webp',
  width: 100,
  height: 80,
})
function deferredImage() {
  let resolve!: (image: AgentImage) => void
  let reject!: (reason: Error) => void
  const promise = new Promise<AgentImage>((done, fail) => {
    resolve = done
    reject = fail
  })
  return { promise, resolve, reject }
}
async function typeText(text: string) {
  ;(textarea().props['onUpdate:modelValue'] as (text: string) => void)(text)
  await nextTick()
}
async function selectFiles(count = 1) {
  const files = Array.from({ length: count }, () => new Blob(['source']))
  const input = findNode((node) => node.props.type === 'file')
  ;(input.props.onChange as (event: unknown) => void)({ target: { files, value: 'selected' } })
  await nextTick()
}
function pressEnter() {
  ;(textarea().props.onKeydown as (event: unknown) => void)({
    key: 'Enter',
    shiftKey: false,
    preventDefault: vi.fn(),
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.processImage.mockReset()
  mocks.store = reactive({
    ...mocks.store,
    agentReady: true,
    agentBusy: false,
    agentRunning: false,
  })
  vi.stubGlobal('Document', class {})
  vi.stubGlobal('ShadowRoot', class {})
  root = new HostNode('root')
  app = renderer.createApp(AgentInput)
  app.mount(root)
})
afterEach(() => {
  app.unmount()
  vi.unstubAllGlobals()
})

it('preserves text and completed attachments until every queued image finishes', async () => {
  const first = image('first')
  const second = image('second')
  const pending = deferredImage()
  mocks.processImage.mockResolvedValueOnce(first).mockReturnValueOnce(pending.promise)
  await typeText('inspect both images')
  await selectFiles(2)
  await vi.waitFor(() => expect(mocks.processImage).toHaveBeenCalledTimes(2))

  expect(sendButton().props.disabled).toBe(true)
  pressEnter()
  await nextTick()
  expect(mocks.store.sendAgentMessage).not.toHaveBeenCalled()
  expect(textarea().value).toBe('inspect both images')
  expect(mocks.disposePreview).not.toHaveBeenCalled()

  pending.resolve(second)
  await vi.waitFor(() => expect(sendButton().props.disabled).toBe(false))
  pressEnter()
  await nextTick()
  expect(mocks.store.sendAgentMessage).toHaveBeenCalledExactlyOnceWith('inspect both images', [
    first,
    second,
  ])
  expect(textarea().value).toBe('')
  expect(mocks.disposePreview).toHaveBeenCalledTimes(2)
})

it('releases the send guard when image processing fails', async () => {
  const pending = deferredImage()
  mocks.processImage.mockReturnValueOnce(pending.promise)
  await typeText('keep this text')
  await selectFiles()
  expect(sendButton().props.disabled).toBe(true)
  pending.reject(new Error('invalid image'))
  await vi.waitFor(() => expect(sendButton().props.disabled).toBe(false))
  expect(findNode((node) => node.props.role === 'alert')).toBeDefined()
  pressEnter()
  expect(mocks.store.sendAgentMessage).toHaveBeenCalledExactlyOnceWith('keep this text', [])
})

it('keeps stop available while a draft image is processing', async () => {
  mocks.store.agentBusy = true
  mocks.store.agentRunning = true
  const pending = deferredImage()
  mocks.processImage.mockReturnValueOnce(pending.promise)
  await selectFiles()
  expect(sendButton().props.disabled).toBe(false)
  ;(sendButton().props.onClick as () => void)()
  expect(mocks.store.stopAgent).toHaveBeenCalledOnce()
  expect(mocks.store.sendAgentMessage).not.toHaveBeenCalled()
  pending.resolve(image('draft'))
  await vi.waitFor(() => expect(mocks.processImage).toHaveBeenCalledOnce())
  await nextTick()
})
