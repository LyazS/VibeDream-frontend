<template>
  <UniversalModal
    :show="show"
    :title="t('project.workspaceSettings.title')"
    width="520px"
    :show-footer="false"
    :loading="running"
    @close="emit('close')"
  >
    <div
      class="workspace-settings"
      role="dialog"
      aria-modal="true"
      :aria-label="t('project.workspaceSettings.title')"
      :aria-busy="running"
    >
      <dl class="workspace-scope">
        <dt>{{ t('project.workspaceSettings.workspace') }}</dt>
        <dd>{{ workspaceName }}</dd>
      </dl>
      <div class="cleanup-row">
        <h4>{{ t('project.workspaceSettings.orphanAttachments') }}</h4>
        <HoverButton class="cleanup-button" :disabled="running" @click="cleanup">
          <template #icon>
            <component
              :is="running ? IconComponents.LOADING : IconComponents.DELETE"
              size="18px"
              :class="{ spinning: running }"
            />
          </template>
          {{
            t(running ? 'project.workspaceSettings.cleaning' : 'project.workspaceSettings.cleanup')
          }}
        </HoverButton>
      </div>
      <div class="cleanup-status" aria-live="polite" aria-atomic="true">
        <p v-if="failed" role="alert" class="cleanup-error">
          {{ t('project.workspaceSettings.failed') }}
        </p>
        <template v-else-if="result">
          <p :class="{ 'cleanup-error': result.failedProjects.length }">
            {{
              result.failedProjects.length
                ? t('project.workspaceSettings.partial', {
                    completed: t('project.workspaceSettings.completed', result.deletedFiles),
                    failed: t(
                      'project.workspaceSettings.failedProjects',
                      result.failedProjects.length,
                    ),
                  })
                : result.deletedFiles
                  ? t('project.workspaceSettings.completed', result.deletedFiles)
                  : result.skippedProjects.length
                    ? t('project.workspaceSettings.notReclaimed')
                    : t('project.workspaceSettings.empty')
            }}
          </p>
          <p v-if="result.skippedProjects.length">
            {{ t('project.workspaceSettings.skipped', result.skippedProjects.length) }}
          </p>
        </template>
      </div>
    </div>
  </UniversalModal>
</template>

<script setup lang="ts">
import { onBeforeUnmount, ref, watch } from 'vue'
import UniversalModal from './UniversalModal.vue'
import HoverButton from '@/components/base/HoverButton.vue'
import { IconComponents } from '@/constants/iconComponents'
import { useAppI18n } from '@/core/composables/useI18n'
import { AgentSessionStore } from '@/core/agent/runtime/AgentSessionStore'
import {
  reclaimWorkspaceAgentImageOrphans,
  type AgentAttachmentCleanupResult,
} from '@/core/agent/services/agentImageService'

const props = defineProps<{ show: boolean; workspaceName: string }>()
const emit = defineEmits<{ close: []; 'running-change': [running: boolean] }>()
const { t } = useAppI18n()
const running = ref(false)
const failed = ref(false)
const result = ref<AgentAttachmentCleanupResult | null>(null)
let controller: AbortController | null = null

watch(
  () => props.show,
  (show) => {
    if (!show) controller?.abort()
    else {
      failed.value = false
      result.value = null
    }
  },
)

async function cleanup() {
  if (running.value || !props.show) return
  const task = new AbortController()
  controller = task
  running.value = true
  failed.value = false
  result.value = null
  emit('running-change', true)
  try {
    const completed = await reclaimWorkspaceAgentImageOrphans(new AgentSessionStore(), task.signal)
    if (!task.signal.aborted) result.value = completed
  } catch {
    if (!task.signal.aborted) failed.value = true
  } finally {
    if (controller === task) {
      controller = null
      running.value = false
      emit('running-change', false)
    }
  }
}

const cancelCleanup = () => controller?.abort()
globalThis.window?.addEventListener('pagehide', cancelCleanup)
onBeforeUnmount(() => {
  cancelCleanup()
  globalThis.window?.removeEventListener('pagehide', cancelCleanup)
})
</script>

<style scoped>
.workspace-settings {
  color: var(--color-text-primary);
}

.workspace-scope {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr);
  align-items: start;
  gap: 16px;
  margin: 0 0 20px;
  font-size: 14px;
}

.workspace-scope dt {
  color: var(--color-text-secondary);
}

.workspace-scope dd {
  margin: 0;
  overflow-wrap: anywhere;
  text-align: right;
}

.cleanup-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding-top: 16px;
  border-top: 1px solid var(--color-border-primary);
}

.cleanup-row h4 {
  margin: 0;
  font-size: 14px;
  font-weight: 500;
}

.cleanup-button {
  min-height: 40px;
  min-width: 140px;
  padding: 8px 12px;
  transition-property: background-color, color, transform;
}

.cleanup-button:active:not(:disabled) {
  transform: scale(0.96);
}

.cleanup-status {
  min-height: 40px;
  margin-top: 12px;
  color: var(--color-text-secondary);
  font-size: 13px;
  font-variant-numeric: tabular-nums;
  line-height: 1.6;
  overflow-wrap: anywhere;
}

.cleanup-status p {
  margin: 0;
}

.cleanup-error {
  color: var(--color-error, #ef6666);
}

.spinning {
  animation: cleanup-spin 1s linear infinite;
}

@keyframes cleanup-spin {
  to {
    transform: rotate(360deg);
  }
}

@media (max-width: 480px) {
  .cleanup-row {
    flex-wrap: wrap;
  }

  .cleanup-button {
    width: 100%;
  }
}

@media (prefers-reduced-motion: reduce) {
  .spinning {
    animation: none;
  }
}
</style>
