<template>
  <div v-if="tasks.length > 0" class="task-center">
    <button
      v-if="!isOpen"
      class="task-center-trigger"
      type="button"
      :title="triggerTitle"
      :aria-label="triggerTitle"
      @click="isOpen = true"
    >
      <component :is="IconComponents.LIST_CHECK" class="trigger-icon" />
      <span v-if="activeRootCount > 0" class="trigger-count">{{ activeRootCount }}</span>
    </button>

    <section v-else class="task-center-panel" aria-label="任务中心">
      <header class="task-center-header">
        <div class="task-center-title">
          <component :is="IconComponents.LIST_CHECK" class="header-icon" />
          <span>任务中心</span>
          <span class="task-count">{{ roots.length }}</span>
        </div>
        <button
          class="icon-button"
          type="button"
          title="收起"
          aria-label="收起任务中心"
          @click="isOpen = false"
        >
          <component :is="IconComponents.CLOSE" />
        </button>
      </header>

      <div class="task-list">
        <article
          v-for="task in roots"
          :key="task.resourceId"
          class="task-row root-row"
          :class="`status-${task.status}`"
        >
          <div class="task-main">
            <button
              class="expand-button"
              type="button"
              :disabled="getChildTasks(task).length === 0"
              :title="isExpanded(task.resourceId) ? '收起子任务' : '展开子任务'"
              :aria-label="isExpanded(task.resourceId) ? '收起子任务' : '展开子任务'"
              @click="toggleExpanded(task.resourceId)"
            >
              <component
                :is="IconComponents.DROPDOWN"
                class="expand-icon"
                :class="{ expanded: isExpanded(task.resourceId) }"
              />
            </button>

            <div class="status-dot" />

            <div class="task-copy">
              <div class="task-line">
                <span class="task-title">{{ task.title }}</span>
                <span class="task-type">{{ task.type }}</span>
              </div>
              <div class="task-meta">
                <span>{{ getStatusLabel(task.status) }}</span>
                <span v-if="task.stage">{{ task.stage }}</span>
                <span v-if="task.queue">{{ task.queue }}</span>
              </div>
              <div v-if="task.errorMessage" class="task-error">{{ task.errorMessage }}</div>
              <div class="progress-track" aria-hidden="true">
                <div class="progress-fill" :style="{ width: `${task.progress}%` }" />
              </div>
            </div>

            <div class="task-actions">
              <button
                class="icon-button"
                type="button"
                title="定位素材"
                aria-label="定位素材"
                :disabled="!getMediaBindingId(task)"
                @click="revealTask(task)"
              >
                <component :is="IconComponents.VISIBLE" />
              </button>
              <button
                v-if="canCancel(task.status)"
                class="icon-button"
                type="button"
                title="取消"
                aria-label="取消任务"
                @click="cancelTask(task)"
              >
                <component :is="IconComponents.STOP" />
              </button>
              <button
                v-if="canRetry(task.status)"
                class="icon-button"
                type="button"
                title="重试"
                aria-label="重试任务"
                @click="retryTask(task)"
              >
                <component :is="IconComponents.REFRESH" />
              </button>
            </div>
          </div>

          <div
            v-if="isExpanded(task.resourceId) && getChildTasks(task).length > 0"
            class="child-list"
          >
            <div
              v-for="child in getChildTasks(task)"
              :key="child.resourceId"
              class="child-row"
              :class="`status-${child.status}`"
            >
              <div class="status-dot" />
              <div class="task-copy">
                <div class="task-line">
                  <span class="task-title">{{ child.title }}</span>
                  <span class="task-type">{{ child.type }}</span>
                </div>
                <div class="task-meta">
                  <span>{{ getStatusLabel(child.status) }}</span>
                  <span v-if="child.stage">{{ child.stage }}</span>
                </div>
              </div>
            </div>
          </div>
        </article>
      </div>
    </section>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { useUnifiedStore } from '@/core/unifiedStore'
import { IconComponents } from '@/constants/iconComponents'
import { JobLogger, type TaskViewItem } from '@/core/jobs'
import type { ResourceStatus } from '@/core/jobs'

const unifiedStore = useUnifiedStore()
const tasks = ref<TaskViewItem[]>([])
const isOpen = ref(true)
const expandedResourceIds = ref<Set<string>>(new Set())
let unsubscribe: (() => void) | undefined

const rootStatuses = new Set<ResourceStatus>(['queued', 'running', 'failed', 'cancelled'])
const activeStatuses = new Set<ResourceStatus>(['queued', 'running'])

const roots = computed(() => {
  const taskRoots = tasks.value.filter((task) => task.isRoot)
  return taskRoots.length > 0 ? taskRoots : tasks.value
})

const activeRootCount = computed(() => {
  return roots.value.filter((task) => rootStatuses.has(task.status)).length
})

const triggerTitle = computed(() => {
  return activeRootCount.value > 0
    ? `任务中心，${activeRootCount.value} 个进行中任务`
    : '任务中心'
})

const taskById = computed(() => {
  return new Map(tasks.value.map((task) => [task.resourceId, task]))
})

onMounted(() => {
  tasks.value = unifiedStore.getJobTaskView()
  unsubscribe = unifiedStore.subscribeJobTaskView((nextTasks) => {
    tasks.value = nextTasks
  })
})

onUnmounted(() => {
  unsubscribe?.()
})

function getStatusLabel(status: ResourceStatus): string {
  const labels: Record<ResourceStatus, string> = {
    idle: '待开始',
    blocked: '等待依赖',
    queued: '排队中',
    running: '处理中',
    succeeded: '已完成',
    failed: '失败',
    cancelled: '已取消',
  }
  return labels[status]
}

function canCancel(status: ResourceStatus): boolean {
  return activeStatuses.has(status)
}

function canRetry(status: ResourceStatus): boolean {
  return status === 'failed' || status === 'cancelled'
}

function isExpanded(resourceId: string): boolean {
  return expandedResourceIds.value.has(resourceId)
}

function toggleExpanded(resourceId: string) {
  const next = new Set(expandedResourceIds.value)
  if (next.has(resourceId)) {
    next.delete(resourceId)
  } else {
    next.add(resourceId)
  }
  expandedResourceIds.value = next
}

function getChildTasks(task: TaskViewItem): TaskViewItem[] {
  const seen = new Set<string>()
  const childTasks: TaskViewItem[] = []

  function collect(resourceId: string) {
    if (seen.has(resourceId)) {
      return
    }
    seen.add(resourceId)

    const child = taskById.value.get(resourceId)
    if (!child) {
      return
    }

    childTasks.push(child)
    child.deps.forEach(collect)
  }

  task.deps.forEach(collect)
  return childTasks
}

function getMediaBindingId(task: TaskViewItem): string | null {
  const binding = task.bindings.find((item) => item.startsWith('media-item:'))
  return binding ? binding.slice('media-item:'.length) : null
}

function revealTask(task: TaskViewItem) {
  const mediaId = getMediaBindingId(task)
  if (!mediaId) {
    return
  }

  unifiedStore.selectLibraryAsset(mediaId)
  JobLogger.info('TaskCenter', 'task:reveal', {
    resourceId: task.resourceId,
    mediaId,
  })
}

async function cancelTask(task: TaskViewItem) {
  await unifiedStore.cancelJobTask(task.resourceId)
}

async function retryTask(task: TaskViewItem) {
  await unifiedStore.retryJobTask(task.resourceId)
}
</script>

<style scoped>
.task-center {
  position: fixed;
  left: 72px;
  bottom: 16px;
  z-index: 1200;
  color: var(--color-text-primary);
}

.task-center-trigger,
.task-center-panel {
  border: 1px solid var(--color-border-primary);
  background: var(--color-bg-secondary);
  box-shadow: 0 12px 36px rgb(0 0 0 / 24%);
}

.task-center-trigger {
  position: relative;
  width: 42px;
  height: 42px;
  display: grid;
  place-items: center;
  border-radius: 8px;
  color: var(--color-text-primary);
  cursor: pointer;
}

.trigger-icon {
  width: 20px;
  height: 20px;
}

.trigger-count {
  position: absolute;
  top: -7px;
  right: -7px;
  min-width: 18px;
  height: 18px;
  padding: 0 5px;
  border-radius: 999px;
  background: var(--color-accent-primary);
  color: #fff;
  font-size: 11px;
  line-height: 18px;
  text-align: center;
}

.task-center-panel {
  width: min(380px, calc(100vw - 96px));
  max-height: min(440px, calc(100vh - 160px));
  display: flex;
  flex-direction: column;
  border-radius: 8px;
  overflow: hidden;
}

.task-center-header {
  height: 42px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 10px 0 12px;
  border-bottom: 1px solid var(--color-border-primary);
}

.task-center-title {
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
  font-weight: 600;
}

.header-icon,
.icon-button svg,
.expand-icon {
  width: 16px;
  height: 16px;
}

.task-count {
  min-width: 20px;
  height: 18px;
  padding: 0 6px;
  border-radius: 999px;
  background: var(--color-bg-tertiary);
  color: var(--color-text-secondary);
  font-size: 11px;
  line-height: 18px;
  text-align: center;
}

.task-list {
  min-height: 0;
  overflow-y: auto;
}

.task-row,
.child-row {
  border-bottom: 1px solid var(--color-border-primary);
}

.task-row:last-child {
  border-bottom: 0;
}

.task-main,
.child-row {
  min-height: 62px;
  display: flex;
  align-items: flex-start;
  gap: 8px;
  padding: 10px;
}

.child-row {
  min-height: 48px;
  padding-left: 44px;
  background: var(--color-bg-primary);
}

.expand-button,
.icon-button {
  width: 28px;
  height: 28px;
  flex: 0 0 28px;
  display: grid;
  place-items: center;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: var(--color-text-secondary);
  cursor: pointer;
}

.expand-button:disabled,
.icon-button:disabled {
  opacity: 0.35;
  cursor: default;
}

.expand-button:not(:disabled):hover,
.icon-button:not(:disabled):hover {
  background: var(--color-bg-tertiary);
  color: var(--color-text-primary);
}

.expand-icon {
  transform: rotate(-90deg);
  transition: transform 0.15s ease;
}

.expand-icon.expanded {
  transform: rotate(0deg);
}

.status-dot {
  width: 8px;
  height: 8px;
  flex: 0 0 8px;
  margin-top: 10px;
  border-radius: 999px;
  background: var(--color-text-tertiary);
}

.task-copy {
  min-width: 0;
  flex: 1;
}

.task-line {
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 8px;
}

.task-title {
  min-width: 0;
  overflow: hidden;
  color: var(--color-text-primary);
  font-size: 12px;
  font-weight: 600;
  line-height: 18px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.task-type {
  flex: 0 0 auto;
  color: var(--color-text-tertiary);
  font-size: 11px;
  line-height: 16px;
}

.task-meta,
.task-error {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  color: var(--color-text-secondary);
  font-size: 11px;
  line-height: 16px;
}

.task-error {
  color: var(--color-error);
}

.progress-track {
  height: 3px;
  margin-top: 7px;
  border-radius: 999px;
  background: var(--color-bg-tertiary);
  overflow: hidden;
}

.progress-fill {
  height: 100%;
  border-radius: inherit;
  background: var(--color-accent-primary);
  transition: width 0.18s ease;
}

.task-actions {
  display: flex;
  flex: 0 0 auto;
  gap: 2px;
}

.child-list {
  border-top: 1px solid var(--color-border-primary);
}

.status-running .status-dot,
.status-queued .status-dot {
  background: var(--color-accent-primary);
}

.status-succeeded .status-dot {
  background: var(--color-success);
}

.status-failed .status-dot {
  background: var(--color-error);
}

.status-cancelled .status-dot {
  background: var(--color-warning);
}

@media (max-width: 720px) {
  .task-center {
    left: 12px;
    right: 12px;
    bottom: 12px;
  }

  .task-center-panel {
    width: 100%;
  }
}
</style>
