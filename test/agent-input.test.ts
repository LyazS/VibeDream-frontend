import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { createRenderer, h, nextTick, reactive, ref, toRaw } from 'vue'
import { createI18n } from 'vue-i18n'
import AgentInput from '../src/components/agent/AgentInput.vue'
import ToolCallDisplay from '../src/components/agent/ToolCallDisplay.vue'
import AgentImagePreview from '../src/components/agent/AgentImage.vue'
import type { AgentImage, AgentMessage } from '../src/core/agent/types'
import type { AgentDraft } from '../src/core/modules/UnifiedAgentModule'
import en from '../src/locales/en-US/common.json'
import zh from '../src/locales/zh-CN/common.json'
import enAi from '../src/locales/en-US/aiPanel.json'
import zhAi from '../src/locales/zh-CN/aiPanel.json'
import { agentImageFixture } from './helpers/agent-files'

vi.mock('@/core/managers/filesystem/fileSystemService', async () => ({
  fileSystemService: (await import('./helpers/agent-files')).agentFileSystem,
}))

const i18n = createI18n({
  legacy: false,
  locale: 'en-US',
  messages: { 'en-US': { ...en, ...enAi }, 'zh-CN': { ...zh, ...zhAi } },
})

const mocks = vi.hoisted(() => ({
  store: {
    agentReady: true,
    agentBusy: false,
    agentRunning: false,
    agentSessionId: 'session',
    agentToolResults: {} as Record<string, AgentMessage>,
    getAgentImage: vi.fn(),
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
  readMediaState: vi.fn(),
  searchMediaState: vi.fn(),
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
vi.mock('@/core/agent/tools/readMedia', () => ({
  useReadMediaExecutionState: mocks.readMediaState,
}))
vi.mock('@/core/agent/tools/searchMedia', () => ({
  useSearchMediaExecutionState: mocks.searchMediaState,
}))
vi.mock('../src/components/agent/IndexingRuntimeCard.vue', () => ({
  default: { render: () => null },
}))
vi.mock('naive-ui', () => ({ NSpin: { render: () => null } }))
vi.mock('@/components/modals/ModalOverlay.vue', () => ({
  default: {
    setup:
      (_props: unknown, { slots }: { slots: { default: () => unknown } }) =>
      () =>
        h('div', slots.default()),
  },
}))
vi.mock('../src/components/agent/AgentUsageIndicator.vue', () => ({
  default: { render: () => null },
}))
vi.mock('@/core/agent/services/agentImageService', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/core/agent/services/agentImageService')>()),
  createAgentImagePreview: mocks.createPreview,
}))

// 使用 Vue 宿主渲染器挂载真实组件，在无浏览器环境中验证输入交互。
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
  closest(selector: string): HostNode | null {
    if (selector === `.${this.props.class}`) return this
    return this.parent?.closest(selector) ?? null
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
  ...agentImageFixture(),
  id,
  blob: new Blob([id], { type: 'image/webp' }),
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
  mocks.readMediaState.mockReturnValue(ref(null))
  mocks.searchMediaState.mockReturnValue(ref(null))
  mocks.createPreview.mockImplementation(() => ({
    url: 'blob:preview',
    dispose: mocks.disposePreview,
  }))
  mocks.store.sendAgentDraft.mockReset()
  mocks.store.getAgentImage.mockReset()
  i18n.global.locale.value = 'en-US'
  mocks.store = reactive({
    ...mocks.store,
    agentReady: true,
    agentBusy: false,
    agentRunning: false,
    agentSessionId: 'session',
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
  vi.useRealTimers()
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

function mountSentImage(inChatScroller = false) {
  app.unmount()
  root = new HostNode('root')
  if (inChatScroller) root.props.class = 'chat-messages-container'
  app = renderer.createApp(AgentImagePreview, { attachmentId: 'original' })
  app.mount(root)
}

function mockPreviewIntersection() {
  let intersect!: (entries: { isIntersecting: boolean }[]) => void
  const options = vi.fn()
  const disconnect = vi.fn()
  vi.stubGlobal(
    'IntersectionObserver',
    class {
      constructor(callback: typeof intersect, init?: IntersectionObserverInit) {
        intersect = callback
        options(init)
      }
      observe() {}
      disconnect = disconnect
    },
  )
  return {
    options,
    disconnect,
    setVisible: (isIntersecting: boolean) => intersect([{ isIntersecting }]),
  }
}

it('opens draft images in the common preview and closes it when switching sessions', async () => {
  const draftImage = image('draft')
  mocks.store.agentDraft.images = [{ id: 'draft', status: 'ready', image: draftImage }]
  await nextTick()
  ;(findNode((node) => node.props.class === 'draft-preview-trigger').props.onClick as () => void)()
  await nextTick()
  expect(findNode((node) => node.props.role === 'dialog').props['aria-label']).toBe(
    draftImage.original.fileName,
  )
  mocks.store.agentSessionId = 'another-session'
  await nextTick()
  expect(findOptional((node) => node.props.role === 'dialog', root)).toBeUndefined()
})

it('keeps an open sent-image preview alive outside the chat buffer until closed', async () => {
  vi.useFakeTimers()
  const intersection = mockPreviewIntersection()
  mocks.store.getAgentImage.mockResolvedValue({
    blob: new Blob(['source']),
    fileName: 'source.png',
  })
  mountSentImage()
  intersection.setVisible(true)
  await vi.advanceTimersByTimeAsync(0)
  ;(findNode((node) => node.props.class === 'image-preview-trigger').props.onClick as () => void)()
  await nextTick()
  intersection.setVisible(false)
  await vi.advanceTimersByTimeAsync(2000)
  expect(findNode((node) => node.props.role === 'dialog').props['aria-label']).toBe('source.png')
  expect(mocks.store.getAgentImage).toHaveBeenCalledOnce()
  expect(mocks.disposePreview).not.toHaveBeenCalled()
  ;(findNode((node) => node.props['aria-label'] === 'Close').props.onClick as () => void)()
  await nextTick()
  expect(findOptional((node) => node.props.role === 'dialog', root)).toBeUndefined()
  expect(mocks.disposePreview).toHaveBeenCalledOnce()
})

it('recreates local sent-image previews after remount and releases their URLs on leaving the view', async () => {
  const blob = new Blob(['original bytes'], { type: 'image/png' })
  mocks.store.getAgentImage.mockResolvedValue({ blob, fileName: 'source.png' })
  mountSentImage()
  await vi.waitFor(() => expect(mocks.createPreview).toHaveBeenCalledWith(blob))
  expect(findNode((node) => node.props.class === 'agent-image').props.title).toBe('source.png')
  mountSentImage()
  await vi.waitFor(() => expect(mocks.createPreview).toHaveBeenCalledTimes(2))
  expect(mocks.disposePreview).toHaveBeenCalledOnce()
  expect(mocks.store.getAgentImage).toHaveBeenNthCalledWith(2, 'original')
})

it('ignores a late local preview read after changing sessions', async () => {
  let finish!: (value: { blob: Blob; fileName: string }) => void
  mocks.store.getAgentImage
    .mockReturnValueOnce(
      new Promise((resolve) => {
        finish = resolve
      }),
    )
    .mockResolvedValue({ blob: new Blob(['current']), fileName: 'current.png' })
  mountSentImage()
  mocks.store.agentSessionId = 'next-session'
  await vi.waitFor(() => expect(mocks.createPreview).toHaveBeenCalledOnce())
  finish({ blob: new Blob(['late']), fileName: 'late.png' })
  await nextTick()
  expect(mocks.createPreview).toHaveBeenCalledOnce()
  expect(findNode((node) => node.props.class === 'agent-image').props.title).toBe('current.png')
})

it('preloads within a 300px buffer of the chat scroller', async () => {
  const intersection = mockPreviewIntersection()
  mocks.store.getAgentImage.mockResolvedValue({
    blob: new Blob(['source']),
    fileName: 'source.png',
  })
  mountSentImage(true)
  expect(intersection.options).toHaveBeenCalledOnce()
  const options = intersection.options.mock.calls[0]![0] as IntersectionObserverInit
  expect(toRaw(options.root)).toBe(root)
  expect(options.rootMargin).toBe('300px 0px')
  expect(mocks.store.getAgentImage).not.toHaveBeenCalled()
  intersection.setVisible(true)
  await vi.waitFor(() => expect(mocks.createPreview).toHaveBeenCalledOnce())
})

it('retains previews during brief scrolls away and releases them after two seconds outside the buffer', async () => {
  vi.useFakeTimers()
  const intersection = mockPreviewIntersection()
  mocks.store.getAgentImage.mockResolvedValue({
    blob: new Blob(['source']),
    fileName: 'source.png',
  })
  mountSentImage()
  expect(intersection.options).toHaveBeenCalledWith({ root: null, rootMargin: '300px 0px' })
  intersection.setVisible(true)
  await vi.advanceTimersByTimeAsync(0)
  expect(mocks.createPreview).toHaveBeenCalledOnce()
  intersection.setVisible(false)
  await vi.advanceTimersByTimeAsync(1999)
  expect(mocks.disposePreview).not.toHaveBeenCalled()
  intersection.setVisible(true)
  await vi.advanceTimersByTimeAsync(2001)
  expect(mocks.disposePreview).not.toHaveBeenCalled()
  expect(mocks.store.getAgentImage).toHaveBeenCalledOnce()
  intersection.setVisible(false)
  await vi.advanceTimersByTimeAsync(2000)
  expect(mocks.disposePreview).toHaveBeenCalledOnce()
  intersection.setVisible(true)
  await vi.advanceTimersByTimeAsync(0)
  expect(mocks.createPreview).toHaveBeenCalledTimes(2)
  expect(mocks.store.getAgentImage).toHaveBeenCalledTimes(2)
})

it('discards a late local read after the delayed release', async () => {
  vi.useFakeTimers()
  const intersection = mockPreviewIntersection()
  let finish!: (value: { blob: Blob; fileName: string }) => void
  mocks.store.getAgentImage
    .mockReturnValueOnce(new Promise((resolve) => (finish = resolve)))
    .mockResolvedValue({ blob: new Blob(['current']), fileName: 'current.png' })
  mountSentImage()
  intersection.setVisible(true)
  await vi.advanceTimersByTimeAsync(0)
  intersection.setVisible(false)
  await vi.advanceTimersByTimeAsync(2000)
  finish({ blob: new Blob(['late']), fileName: 'late.png' })
  await vi.advanceTimersByTimeAsync(0)
  expect(mocks.createPreview).not.toHaveBeenCalled()
  intersection.setVisible(true)
  await vi.advanceTimersByTimeAsync(0)
  expect(mocks.createPreview).toHaveBeenCalledOnce()
  expect(findNode((node) => node.props.class === 'agent-image').props.title).toBe('current.png')
})

it('immediately releases previews and cancels pending timers on a session change or unmount', async () => {
  vi.useFakeTimers()
  const intersection = mockPreviewIntersection()
  mocks.store.getAgentImage.mockResolvedValue({
    blob: new Blob(['source']),
    fileName: 'source.png',
  })
  mountSentImage()
  intersection.setVisible(true)
  await vi.advanceTimersByTimeAsync(0)
  intersection.setVisible(false)
  await vi.advanceTimersByTimeAsync(500)
  mocks.store.agentSessionId = 'next-session'
  await nextTick()
  expect(mocks.disposePreview).toHaveBeenCalledOnce()
  expect(mocks.store.getAgentImage).toHaveBeenCalledOnce()
  expect(vi.getTimerCount()).toBe(0)
  intersection.setVisible(true)
  await vi.advanceTimersByTimeAsync(0)
  expect(mocks.createPreview).toHaveBeenCalledTimes(2)
  intersection.setVisible(false)
  expect(vi.getTimerCount()).toBe(1)
  app.unmount()
  expect(mocks.disposePreview).toHaveBeenCalledTimes(2)
  expect(vi.getTimerCount()).toBe(0)
  expect(intersection.disconnect).toHaveBeenCalledOnce()
  app = renderer.createApp(AgentInput)
  app.mount(root)
})

it.each([
  [
    'AGENT_IMAGE_SOURCE_MISSING',
    'The original image is missing from this project.',
    '工程中的原图已不存在。',
  ],
  [
    'AGENT_IMAGE_RECORD_MISSING',
    'This image attachment record is missing.',
    '这张图片的附件记录已不存在。',
  ],
])('shows a localized accessible missing state for %s', async (code, english, chinese) => {
  mocks.store.getAgentImage.mockRejectedValue({ code })
  mountSentImage()
  await vi.waitFor(() =>
    expect(findNode((node) => node.props.role === 'alert').props['aria-label']).toBe(english),
  )
  expect(mocks.createPreview).not.toHaveBeenCalled()
  i18n.global.locale.value = 'zh-CN'
  await nextTick()
  expect(findNode((node) => node.props.role === 'alert').props['aria-label']).toBe(chinese)
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
  expect(alert.value).toBe('Up to 9 images per message')
  i18n.global.locale.value = 'zh-CN'
  await nextTick()
  expect(alert.value).toBe('每条消息最多添加 9 张图片')
  i18n.global.locale.value = 'en-US'
  await nextTick()
  expect(alert.value).toBe('Up to 9 images per message')
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

it.each(['LOCAL_SAVE_FAILED', '对话图片存储事务失败'])(
  'localizes preparation and submission errors during local commit without exposing %s',
  async (submitError) => {
    mocks.store.agentDraft = {
      text: 'locked input',
      images: [{ id: 'failed', status: 'failed', error: 'imageInvalid' }],
      imageError: null,
      submitting: true,
      submitError,
    }
    await nextTick()
    expect(textarea().props.disabled).toBe(true)
    expect(findNode((node) => node.props.class === 'remove-image').props.disabled).toBe(true)
    expect(findNode((node) => node.props.role === 'alert').value).toBe(
      'Choose a valid JPEG, PNG or WebP image',
    )
    const notice = findNode((node) => node.props.role === 'alert' && 'title' in node.props)
    expect(notice.props.title).toBe(en.common.chat.draftSubmitFailed)
    expect(notice.value).toBe('Unable to save the message. Try sending again.')
    i18n.global.locale.value = 'zh-CN'
    await nextTick()
    expect(findNode((node) => node.props.role === 'alert').value).toBe(
      '请选择有效的 JPEG、PNG 或 WebP 图片',
    )
    expect(notice.props.title).toBe(zh.common.chat.draftSubmitFailed)
    expect(notice.value).toBe('消息保存失败，请重新发送')
    expect(mocks.store.agentDraft.submitError).toBe(submitError)
  },
)

it('translates recognized submission error codes in the tooltip when switching languages', async () => {
  mocks.store.agentDraft.submitError = 'QuotaExceededError'
  await nextTick()
  const notice = findNode((node) => node.props.role === 'alert' && 'title' in node.props)
  expect(notice.props.title).toBe(enAi.aiPanel.errors.storageQuotaExceeded)
  i18n.global.locale.value = 'zh-CN'
  await nextTick()
  expect(notice.props.title).toBe(zhAi.aiPanel.errors.storageQuotaExceeded)
  expect(mocks.store.agentDraft.submitError).toBe('QuotaExceededError')
})

it('loads ordered tool result previews only while expanded and releases their URLs on collapse', async () => {
  mocks.store.agentToolResults = {
    generic: {
      id: 'result',
      role: 'tool',
      toolCallId: 'generic',
      toolName: 'read_project_info',
      created_at: '',
      parts: [
        { type: 'image', attachmentId: 'first' },
        { type: 'image', attachmentId: 'second' },
      ],
    },
  } as never
  mocks.store.getAgentImage.mockImplementation(async (id: string) => ({
    blob: new Blob([id]),
    fileName: id,
    description: `说明 ${id}`,
  }))
  app.unmount()
  app = renderer.createApp(ToolCallDisplay, {
    item: {
      type: 'tool_call',
      tool_call_id: 'generic',
      tool_name: 'read_project_info',
      args: {},
      status: 'completed',
    },
  })
  app.mount(root)
  await nextTick()
  expect(findOptional((node) => node.props.class === 'tool-result-images', root)).toBeUndefined()
  expect(mocks.store.getAgentImage).not.toHaveBeenCalled()
  const toggleExpanded = findNode(
    (node) => node.props.class === 'tool-header tool-header--interactive',
  ).props.onClick as () => void
  toggleExpanded()
  await nextTick()
  await Promise.resolve()
  await nextTick()
  expect(mocks.store.getAgentImage.mock.calls.map(([id]) => id)).toEqual(['first', 'second'])
  const expanded = findNode((node) => node.props.class === 'tool-params-expanded')
  const images = findNode((node) => node.props.class === 'tool-result-images', expanded)
  expect(findNode((node) => node.props.title === '说明 first', images)).toBeDefined()
  expect(findNode((node) => node.props.title === '说明 second', images)).toBeDefined()
  toggleExpanded()
  await nextTick()
  expect(findOptional((node) => node.props.class === 'tool-params-expanded', root)).toBeUndefined()
  expect(mocks.disposePreview).toHaveBeenCalledTimes(2)
  toggleExpanded()
  await nextTick()
  await Promise.resolve()
  await nextTick()
  expect(mocks.store.getAgentImage.mock.calls.map(([id]) => id)).toEqual([
    'first',
    'second',
    'first',
    'second',
  ])
  app.unmount()
  expect(mocks.disposePreview).toHaveBeenCalledTimes(4)
})

it('does not add a preview region to a text-only paired tool result', async () => {
  mocks.store.agentToolResults = {
    generic: {
      id: 'result',
      role: 'tool',
      toolCallId: 'generic',
      toolName: 'view_media',
      created_at: '',
      parts: [{ type: 'text', text: 'failed' }],
    },
  } as never
  app.unmount()
  app = renderer.createApp(ToolCallDisplay, {
    item: {
      type: 'tool_call',
      tool_call_id: 'generic',
      tool_name: 'view_media',
      args: {},
      status: 'failed',
    },
  })
  app.mount(root)
  ;(
    findNode((node) => node.props.class === 'tool-header tool-header--interactive').props
      .onClick as () => void
  )()
  await nextTick()
  expect(findOptional((node) => node.props.class === 'tool-result-images', root)).toBeUndefined()
  expect(mocks.store.getAgentImage).not.toHaveBeenCalled()
})

it.each(['read_media', 'search_indexing', 'search_media'])(
  'shows actual stopped progress including zero for %s',
  async (mode) => {
    const state = reactive({
      active: false,
      canCancel: false,
      currentStage: mode === 'search_indexing' ? 'indexing' : 'searching',
      totalCount: 5,
      completedCount: 0,
      failedCount: 0,
      indexingTotalCount: 5,
      indexingResolvedCount: 0,
      totalSteps: 5,
      completedSteps: 0,
    })
    if (mode === 'read_media') mocks.readMediaState.mockReturnValue(ref(state))
    else mocks.searchMediaState.mockReturnValue(ref(state))
    app.unmount()
    app = renderer.createApp(ToolCallDisplay, {
      item: {
        type: 'tool_call',
        tool_call_id: 'progress',
        tool_name: mode === 'read_media' ? 'read_media' : 'search_media',
        args: {},
        status: 'failed',
      },
    })
    app.mount(root)
    for (const completed of [0, 2, 5]) {
      state.completedCount = completed
      state.indexingResolvedCount = completed
      state.completedSteps = completed
      await nextTick()
      expect(findNode((node) => node.props.class === 'tool-progress-fill').props.style).toEqual({
        width: `${completed * 20}%`,
      })
    }
  },
)
