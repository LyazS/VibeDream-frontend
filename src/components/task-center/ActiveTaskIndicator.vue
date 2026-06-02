<template>
  <n-popover v-if="activeTasks.length > 0" placement="bottom-end" trigger="click">
    <template #trigger>
      <button class="task-indicator" type="button" :title="t('editor.taskCenter.indicatorTitle')">
        <component :is="IconComponents.LOADING" size="16px" class="task-indicator-icon" />
        <span class="task-indicator-badge">{{ displayCount }}</span>
      </button>
    </template>

    <ActiveTaskDropdown :items="activeTasks" />
  </n-popover>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { NPopover } from 'naive-ui'
import ActiveTaskDropdown from '@/components/task-center/ActiveTaskDropdown.vue'
import { useAppI18n } from '@/core/composables/useI18n'
import { useUnifiedStore } from '@/core/unifiedStore'
import { IconComponents } from '@/constants/iconComponents'
import type { TaskView } from '@/core/jobs/TaskViewAdapter'

interface ActiveTaskItem {
  id: string
  title: string
  subtitle?: string
  status: ActiveTaskStatus
  progress?: number
}

type ActiveTaskStatus = 'idle' | 'queued' | 'running'

const ACTIVE_STATUSES = new Set(['idle', 'queued', 'running'] as const)
const VISIBLE_ROOT_TYPES = new Set([
  'media-ready',
  'media-index-metadata-writeback',
  'ai-generated-media',
  'asr-subtitles',
  'effect-template-ready',
])

const unifiedStore = useUnifiedStore()
const { t } = useAppI18n()

const activeTasks = computed<ActiveTaskItem[]>(() => {
  const filteredTasks = unifiedStore.jobTaskViews.filter(
    (task): task is TaskView & { status: ActiveTaskStatus } =>
      isActiveStatus(task.status) && VISIBLE_ROOT_TYPES.has(getTaskType(task)),
  )

  return filteredTasks
    .sort((left, right) => statusPriority(left.status) - statusPriority(right.status))
    .map((task) => ({
      id: task.id,
      title: formatTaskTitle(task),
      subtitle: formatTaskSubtitle(task),
      status: task.status,
      progress: normalizeProgress(task.progress),
    }))
})

const displayCount = computed(() =>
  activeTasks.value.length > 99 ? '99+' : String(activeTasks.value.length),
)

function getTaskType(task: TaskView) {
  const separatorIndex = task.id.indexOf(':')
  return separatorIndex >= 0 ? task.id.slice(0, separatorIndex) : task.id
}

function getTaskKey(task: TaskView) {
  const separatorIndex = task.id.indexOf(':')
  return separatorIndex >= 0 ? task.id.slice(separatorIndex + 1) : task.id
}

function formatTaskTitle(task: TaskView) {
  const name = resolveTaskObjectName(task)

  switch (getTaskType(task)) {
    case 'media-ready':
      return `${t('editor.taskCenter.titles.mediaReady')}：${name}`
    case 'timeline-item-ready':
      return `${t('editor.taskCenter.titles.timelineItemReady')}：${name}`
    case 'ai-generated-media':
      return `${t('editor.taskCenter.titles.aiGeneratedMedia')}：${name}`
    case 'media-index-metadata-writeback':
      return `${t('editor.taskCenter.titles.mediaIndexing')}：${name}`
    case 'asr-subtitles':
      return `${t('editor.taskCenter.titles.asrSubtitles')}：${name}`
    case 'effect-template-ready':
      return `${t('editor.taskCenter.titles.effectTemplateReady')}：${name}`
    default:
      return task.title || task.id
  }
}

function formatTaskSubtitle(task: TaskView) {
  if (task.message && task.message !== task.title) {
    return task.message
  }

  switch (task.status) {
    case 'idle':
      return t('editor.taskCenter.statuses.idle')
    case 'queued':
      return t('editor.taskCenter.statuses.queued')
    case 'running':
      return t('editor.taskCenter.statuses.running')
  }
}

function resolveTaskObjectName(task: TaskView) {
  const key = getTaskKey(task)

  switch (getTaskType(task)) {
    case 'media-ready':
    case 'media-index-metadata-writeback':
    case 'ai-generated-media':
      return unifiedStore.getMediaItem(key)?.name || key
    case 'effect-template-ready':
      return unifiedStore.getAsset(key)?.name || key
    case 'asr-subtitles': {
      const placeholder = unifiedStore.getTimelineItem(key)
      const sourceTimelineItemId = placeholder?.task?.sourceTimelineItemId
      if (sourceTimelineItemId) {
        return resolveTimelineItemName(sourceTimelineItemId) || key
      }
      return resolveTimelineItemName(key) || key
    }
    case 'timeline-item-ready':
      return resolveTimelineItemName(key) || key
    default:
      return key
  }
}

function resolveTimelineItemName(timelineItemId: string) {
  const timelineItem = unifiedStore.getTimelineItem(timelineItemId)
  if (!timelineItem) {
    return null
  }

  if (typeof timelineItem.mediaItemId === 'string') {
    const mediaName = unifiedStore.getMediaItem(timelineItem.mediaItemId)?.name
    if (mediaName) {
      return mediaName
    }
  }

  return timelineItem.id
}

function normalizeProgress(progress?: number) {
  if (typeof progress !== 'number' || Number.isNaN(progress)) {
    return undefined
  }

  return Math.max(0, Math.min(1, progress))
}

function isActiveStatus(status: TaskView['status']): status is ActiveTaskStatus {
  return ACTIVE_STATUSES.has(status as ActiveTaskStatus)
}

function statusPriority(status: ActiveTaskStatus) {
  switch (status) {
    case 'running':
      return 0
    case 'queued':
      return 1
    case 'idle':
      return 2
  }
}
</script>

<style scoped>
.task-indicator {
  position: relative;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  min-width: 42px;
  height: 28px;
  padding: 0 10px;
  border: none;
  border-radius: var(--border-radius-medium);
  background: color-mix(in srgb, var(--color-bg-quaternary) 88%, transparent);
  color: var(--color-text-primary);
  cursor: pointer;
  transition: background-color 0.2s ease, color 0.2s ease, transform 0.2s ease;
}

.task-indicator:hover {
  background: color-mix(in srgb, var(--color-bg-quaternary) 100%, #1f9d55 12%);
}

.task-indicator:active {
  transform: translateY(1px);
}

.task-indicator-icon {
  color: #1f9d55;
  animation: task-indicator-spin 1.15s linear infinite;
}

.task-indicator-badge {
  min-width: 18px;
  padding: 0 5px;
  border-radius: 999px;
  background: color-mix(in srgb, #1f9d55 18%, var(--color-bg-primary));
  color: var(--color-text-primary);
  font-size: 11px;
  font-weight: 700;
  line-height: 18px;
  text-align: center;
}

@keyframes task-indicator-spin {
  from {
    transform: rotate(0deg);
  }

  to {
    transform: rotate(360deg);
  }
}
</style>
