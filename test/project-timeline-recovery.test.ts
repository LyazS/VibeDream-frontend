import { ref } from 'vue'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createUnifiedProjectModule } from '@/core/modules/UnifiedProjectModule'
import { ModuleRegistry, MODULE_NAMES } from '@/core/modules/ModuleRegistry'
import { TimelineItemFactory } from '@/core/timelineitem/runtime/factory'
import type { UnifiedTimelineItemData } from '@/core/timelineitem/model/timelineItem'

vi.mock('@/core/utils', () => ({ ProjectFileOps: {} }))
vi.mock('@/core/timelineitem/runtime/factory', () => ({
  TimelineItemFactory: { buildForDag: vi.fn() },
}))
vi.mock('@/core/timelineitem/queries', () => ({
  TimelineItemQueries: { getBaseTransition: () => undefined },
}))
vi.mock('@/core/managers/media/globalMetaFileManager', () => ({ globalMetaFileManager: {} }))
vi.mock('@/core/managers/media/MediaItemLoader', () => ({ globalMediaItemLoader: {} }))
vi.mock('@/core/effect-template/EffectTemplateRegistry', () => ({ effectTemplateRegistry: {} }))
vi.mock('@/core/jobs', () => ({
  shouldRecoverMediaIndexing: vi.fn(),
  shouldRecoverMusicSemantic: vi.fn(),
}))
vi.mock('@/core/composables/useProjectThumbnailService', () => ({
  useProjectThumbnailService: () => ({}),
}))
vi.mock('@/core/composables/useI18n', () => ({ useAppI18n: () => ({ t: (key: string) => key }) }))
vi.mock('@/locales', () => ({ i18n: { global: { t: (key: string) => key } } }))

function textItem(id: string, timelineStatus: 'ready' | 'loading' = 'ready') {
  return {
    id,
    trackId: 'subtitles',
    mediaItemId: null,
    mediaType: 'text',
    timelineStatus,
    baseRenderConfig: { text: 'Existing subtitle' },
    exRenderConfig: {},
    runtime: { isInitialized: true, exRenderConfig: {} },
  } as UnifiedTimelineItemData<'text'>
}

function setupProject() {
  const registry = new ModuleRegistry()
  const timelineItems = ref<UnifiedTimelineItemData[]>([])
  const addTimelineItem = vi.fn(async (item: UnifiedTimelineItemData) => {
    timelineItems.value.push(item)
  })
  registry.register(MODULE_NAMES.CONFIG, {})
  registry.register(MODULE_NAMES.TIMELINE, { timelineItems, addTimelineItem })
  registry.register(MODULE_NAMES.TRACK, { tracks: ref([{ id: 'subtitles' }]) })
  registry.register(MODULE_NAMES.MEDIA, { mediaItems: ref([]), getMediaItem: vi.fn() })
  registry.register(MODULE_NAMES.DIRECTORY, {})
  const project = createUnifiedProjectModule(registry)
  const ensureResolved = vi.fn(async () => undefined)
  project.setTimelineItemResolvedEnsurer(ensureResolved)
  return { project, timelineItems, ensureResolved }
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.spyOn(console, 'log').mockImplementation(() => {})
  vi.mocked(TimelineItemFactory.buildForDag).mockImplementation(async (options) => ({
    timelineItem: options.originalTimelineItemData,
    success: true,
  }))
})

afterEach(() => vi.restoreAllMocks())

describe('project timeline recovery', () => {
  it('restores ready text clips without scheduling a task', async () => {
    const { project, timelineItems, ensureResolved } = setupProject()
    const subtitle = textItem('completed-subtitle')

    await project.restoreTimelineItems([subtitle])

    expect(timelineItems.value.map((item) => item.id)).toEqual(['completed-subtitle'])
    expect(timelineItems.value[0]?.baseRenderConfig).toEqual(subtitle.baseRenderConfig)
    expect(TimelineItemFactory.buildForDag).toHaveBeenCalledOnce()
    expect(ensureResolved).not.toHaveBeenCalled()
  })

  it('continues resolving regular loading clips', async () => {
    const { project, timelineItems, ensureResolved } = setupProject()
    const loadingItem = textItem('loading-text', 'loading')

    await project.restoreTimelineItems([loadingItem])

    expect(timelineItems.value.map((item) => item.id)).toEqual(['loading-text'])
    expect(ensureResolved).toHaveBeenCalledExactlyOnceWith('loading-text')
  })
})
