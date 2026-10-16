import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { createRenderer, nextTick, reactive } from 'vue'
import { createI18n } from 'vue-i18n'
import AgentInput from '../src/components/agent/AgentInput.vue'
import type { AgentImage } from '../src/core/agent/types'
import type { AgentDraft } from '../src/core/modules/UnifiedAgentModule'
import en from '../src/locales/en-US/common.json'
import zh from '../src/locales/zh-CN/common.json'

const i18n = createI18n({
  legacy: false,
  locale: 'en-US',
  messages: { 'en-US': en, 'zh-CN': zh },
})

const mocks = vi.hoisted(() => ({
  store: {
    agentReady: true,
    agentBusy: false,
    agentRunning: false,
    agentDraft: {} as AgentDraft,
    agentDraftEditable: true,
    agentDraftSendable: false,
    setAgentDraftText: vi.fn(),
    addAgentDraftImages: vi.fn(),
    removeAgentDraftImage: vi.fn(),
    retryAgentDraftImage: vi.fn(),
    clearAgentDraft: vi.fn(),
    sendAgentDraft: vi.fn(),
    stopAgent: vi.fn(),
  },
  createPreview: vi.fn(),
  disposePreview: vi.fn(),
}))
vi.mock('@/core/unifiedStore', () => ({ useUnifiedStore: () => mocks.store }))
vi.mock('@/core/composables/useI18n', () => ({ useAppI18n: () => ({ t: i18n.global.t }) }))
vi.mock('@/constants/iconComponents', () => ({
  IconComponents: {
    CLOSE: 'span',
    IMAGE_SMALL: 'span',
    STOP: 'span',
    SEND: 'span',
    WARNING: 'span',
    LOADING: 'span',
    REFRESH: 'span',
  },
}))
vi.mock('naive-ui', () => ({ NImage: { render: () => null } }))
vi.mock('../src/components/agent/AgentUsageIndicator.vue', () => ({
  default: { render: () => null },
}))
vi.mock('@/core/agent/services/agentImageService', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/core/agent/services/agentImageService')>()),
  createAgentImagePreview: mocks.createPreview,
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
  setText: (node, text) => {
    node.value = text
  },
  setElementText: (node, text) => {
    node.value = text
  },
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
  mocks.createPreview.mockImplementation(() => ({
    url: 'blob:preview',
    dispose: mocks.disposePreview,
  }))
  mocks.store.sendAgentDraft.mockReset()
  i18n.global.locale.value = 'en-US'
  mocks.store = reactive({
    ...mocks.store,
    agentReady: true,
    agentBusy: false,
    agentRunning: false,
    agentDraft: { text: '', images: [], imageError: null, submitting: false, submitError: null },
    get agentDraftEditable() {
      return !this.agentDraft.submitting && (!this.agentBusy || this.agentRunning)
    },
    get agentDraftSendable() {
      return (
        !this.agentBusy &&
        !this.agentDraft.submitting &&
        this.agentDraft.images.every((item) => item.status === 'ready') &&
        Boolean(this.agentDraft.text.trim() || this.agentDraft.images.length)
      )
    },
  })
  mocks.store.setAgentDraftText.mockImplementation((text: string) => {
    if (mocks.store.agentDraftEditable) mocks.store.agentDraft.text = text
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

it('reads shared preparation state and sends through the module without clearing a rejected draft', async () => {
  await typeText('inspect both images')
  mocks.store.agentDraft.images = [
    { id: 'first', status: 'ready', image: image('first') },
    { id: 'second', status: 'processing' },
  ]
  await nextTick()

  expect(sendButton().props.disabled).toBe(true)
  pressEnter()
  await nextTick()
  expect(mocks.store.sendAgentDraft).not.toHaveBeenCalled()
  expect(textarea().value).toBe('inspect both images')
  expect(mocks.disposePreview).not.toHaveBeenCalled()

  mocks.store.agentDraft.images = [
    ...mocks.store.agentDraft.images.slice(0, 1),
    { id: 'second', status: 'ready', image: image('second') },
  ]
  await nextTick()
  expect(sendButton().props.disabled).toBe(false)
  mocks.store.sendAgentDraft.mockResolvedValue(false)
  pressEnter()
  await nextTick()
  expect(mocks.store.sendAgentDraft).toHaveBeenCalledExactlyOnceWith()
  expect(textarea().value).toBe('inspect both images')
  expect(mocks.disposePreview).not.toHaveBeenCalled()
  mocks.store.agentDraft = {
    text: '',
    images: [],
    imageError: null,
    submitting: false,
    submitError: null,
  }
  await nextTick()
  expect(textarea().value).toBe('')
  expect(mocks.disposePreview).toHaveBeenCalledTimes(2)
})

it('keeps failed images visible and blocks sending until removal or retry succeeds', async () => {
  await typeText('keep this text')
  mocks.store.agentDraft.images = [{ id: 'failed', status: 'failed', error: 'imageInvalid' }]
  await nextTick()
  expect(findNode((node) => node.props.role === 'alert')).toBeDefined()
  expect(sendButton().props.disabled).toBe(true)
  pressEnter()
  expect(mocks.store.sendAgentDraft).not.toHaveBeenCalled()
  ;(findNode((node) => node.props.class === 'retry-image').props.onClick as () => void)()
  expect(mocks.store.retryAgentDraftImage).toHaveBeenCalledWith('failed')
  ;(findNode((node) => node.props.class === 'remove-image').props.onClick as () => void)()
  expect(mocks.store.removeAgentDraftImage).toHaveBeenCalledWith('failed')
})

it('keeps stop available while a draft image is processing', async () => {
  mocks.store.agentBusy = true
  mocks.store.agentRunning = true
  mocks.store.agentDraft.images = [{ id: 'processing', status: 'processing' }]
  await selectFiles()
  expect(sendButton().props.disabled).toBe(false)
  ;(sendButton().props.onClick as () => void)()
  expect(mocks.store.stopAgent).toHaveBeenCalledOnce()
  expect(mocks.store.sendAgentDraft).not.toHaveBeenCalled()
})

it('updates the visible image count warning when the language changes', async () => {
  mocks.store.agentDraft.imageError = 'imageCountLimit'
  await nextTick()
  const alert = findNode((node) => node.props.role === 'alert')
  expect(alert.value).toBe('Up to 4 images per message')
  i18n.global.locale.value = 'zh-CN'
  await nextTick()
  expect(alert.value).toBe('每条消息最多添加 4 张图片')
  i18n.global.locale.value = 'en-US'
  await nextTick()
  expect(alert.value).toBe('Up to 4 images per message')
})

it('restores shared text and images after unmount, recreating only component preview URLs', async () => {
  await typeText('line 1\nline 2\nline 3\nline 4')
  mocks.store.agentDraft.images = [
    { id: 'ready', status: 'ready', image: image('ready') },
    { id: 'processing', status: 'processing' },
  ]
  await nextTick()
  expect(mocks.createPreview).toHaveBeenCalledOnce()
  app.unmount()
  expect(mocks.disposePreview).toHaveBeenCalledOnce()
  mocks.store.agentDraft.images = [
    ...mocks.store.agentDraft.images.slice(0, 1),
    { id: 'processing', status: 'ready', image: image('finished while hidden') },
  ]
  await nextTick()
  expect(mocks.createPreview).toHaveBeenCalledOnce()
  root = new HostNode('root')
  app = renderer.createApp(AgentInput)
  app.mount(root)
  expect(textarea().value).toBe('line 1\nline 2\nline 3\nline 4')
  expect(textarea().props.style).toMatchObject({ height: '96px' })
  expect(mocks.createPreview).toHaveBeenCalledTimes(3)
  expect(mocks.store.clearAgentDraft).not.toHaveBeenCalled()
})

it('forwards file selection, paste and drop to the module', async () => {
  await selectFiles(2)
  expect(mocks.store.addAgentDraftImages.mock.lastCall?.[0]).toHaveLength(2)
  const file = new Blob(['pasted image'])
  const wrapper = findNode((node) => node.props.class === 'chat-input-wrapper')
  ;(wrapper.props.onPaste as (event: unknown) => void)({
    clipboardData: { items: [{ kind: 'file', getAsFile: () => file }] },
    preventDefault: vi.fn(),
  })
  expect(mocks.store.addAgentDraftImages).toHaveBeenLastCalledWith([file])
  ;(wrapper.props.onDrop as (event: unknown) => void)({
    dataTransfer: { files: [file] },
    preventDefault: vi.fn(),
    stopPropagation: vi.fn(),
  })
  expect(mocks.store.addAgentDraftImages).toHaveBeenCalledTimes(3)
})

it('restores localized preparation and submission errors and disables edits during local commit', async () => {
  mocks.store.agentDraft = {
    text: 'locked input',
    images: [{ id: 'failed', status: 'failed', error: 'imageInvalid' }],
    imageError: null,
    submitting: true,
    submitError: 'LOCAL_SAVE_FAILED',
  }
  await nextTick()
  expect(textarea().props.disabled).toBe(true)
  expect(findNode((node) => node.props.class === 'remove-image').props.disabled).toBe(true)
  expect(findNode((node) => node.props.role === 'alert').value).toBe(
    'Choose a valid JPEG, PNG or WebP image',
  )
  expect(findNode((node) => node.props.title === 'LOCAL_SAVE_FAILED').value).toBe(
    'Unable to save the message. Try sending again.',
  )
  i18n.global.locale.value = 'zh-CN'
  await nextTick()
  expect(findNode((node) => node.props.role === 'alert').value).toBe(
    '请选择有效的 JPEG、PNG 或 WebP 图片',
  )
  expect(findNode((node) => node.props.title === 'LOCAL_SAVE_FAILED').value).toBe(
    '消息保存失败，请重新发送',
  )
})
