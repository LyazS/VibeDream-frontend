import { isRef, toRaw } from 'vue'
import router from '@/router'
import { fileSystemService } from '@/core/managers'
import { useUnifiedStore } from '@/core/unifiedStore'
import type { EvalSnapshot, AgentEval } from '@/types/global'

const DEFAULT_TIMEOUT_MS = 120_000
const POLL_INTERVAL_MS = 50

function assertProjectId(projectId: string): void {
  if (!/^[a-zA-Z0-9_-]{1,120}$/.test(projectId)) throw new Error('INVALID_PROJECT_ID')
}

function normalizePath(path: string): string {
  const normalized = path.replaceAll('\\', '/')
  if (
    !normalized ||
    normalized.startsWith('/') ||
    normalized.split('/').some((part) => !part || part === '.' || part === '..')
  ) {
    throw new Error('INVALID_WORKSPACE_PATH')
  }
  return normalized
}

async function sha256(blob: Blob): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', await blob.arrayBuffer())
  return [...new Uint8Array(digest)].map((value) => value.toString(16).padStart(2, '0')).join('')
}

function stable(value: unknown, seen = new WeakSet<object>()): unknown {
  if (isRef(value)) return stable(value.value, seen)
  if (value === null || typeof value !== 'object') {
    return typeof value === 'bigint' ? String(value) : value
  }
  if (value instanceof Blob || value instanceof ArrayBuffer || value instanceof URL)
    return undefined
  if (seen.has(value)) return '[Circular]'
  seen.add(value)
  if (Array.isArray(value)) return value.map((item) => stable(toRaw(item), seen))
  const result: Record<string, unknown> = {}
  for (const [key, item] of Object.entries(toRaw(value) as Record<string, unknown>)) {
    if (['runtime', 'blob', 'objectUrl', 'previewUrl', 'signedUrl', 'thumbnail'].includes(key))
      continue
    const normalized = stable(item, seen)
    if (normalized !== undefined) result[key] = normalized
  }
  return result
}

function createSnapshot(store: ReturnType<typeof useUnifiedStore>): EvalSnapshot {
  return {
    project: {
      config: stable({
        projectId: store.projectId,
        projectName: store.projectName,
        projectDescription: store.projectDescription,
        projectCreatedAt: store.projectCreatedAt,
        projectUpdatedAt: store.projectUpdatedAt,
        projectVersion: store.projectVersion,
        videoResolution: store.videoResolution,
        timelineDurationFrames: store.timelineDurationFrames,
      }),
      tracks: stable(store.tracks) as unknown[],
      timelineItems: stable(store.timelineItems) as unknown[],
      mediaItems: stable(store.mediaItems) as unknown[],
    },
    agent: {
      sessionId: store.agentSessionId ?? null,
      messages: stable(store.agentMessages) as unknown[],
      toolExecutions: stable(store.agentToolExecutions),
      pendingInteraction: stable(store.agentPendingInteraction),
      latestModelCall: stable(store.agentModelCall),
      usage: stable(store.agentUsage),
      connection: stable(store.agentConnection),
      ready: Boolean(store.agentReady),
      historyLoading: Boolean(store.agentHistoryLoading),
      draftSendable: Boolean(store.agentDraftSendable),
      draftSubmitting: Boolean(store.agentDraft?.submitting),
      draftEditable: Boolean(store.agentDraftEditable),
    },
  }
}

async function blobToBase64(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer())
  let binary = ''
  const chunkSize = 0x8000
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize))
  }
  return btoa(binary)
}

async function collectWorkspaceFiles(
  path: string,
): Promise<Array<{ path: string; base64: string }>> {
  const entries = await fileSystemService.listDirectory(path)
  const files: Array<{ path: string; base64: string }> = []
  for (const entry of entries) {
    if (entry.kind === 'directory') {
      files.push(...(await collectWorkspaceFiles(entry.path)))
      continue
    }
    files.push({
      path: entry.path,
      base64: await blobToBase64(await fileSystemService.readFileAsBlob(entry.path)),
    })
  }
  return files
}

/** 仅用于显式评估开关下导出案例制作素材；不属于 Agent 操作接口。 */
export async function downloadEvalWorkspace(projectId: string): Promise<void> {
  assertProjectId(projectId)
  const files = await collectWorkspaceFiles(fileSystemService.paths.getProjectPath(projectId))
  const payload = new Blob([JSON.stringify({ projectId, files })], {
    type: 'application/json',
  })
  const url = URL.createObjectURL(payload)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = `${projectId}.workspace.json`
  anchor.click()
  URL.revokeObjectURL(url)
}

function lastMessageId(store: ReturnType<typeof useUnifiedStore>): string {
  const messages = store.agentMessages as readonly { id?: string }[]
  const id = messages[messages.length - 1]?.id
  if (!id) throw new Error('AGENT_TURN_NOT_CREATED')
  return id
}

function installBrowserHarness(): AgentEval {
  const store = useUnifiedStore()
  let prepared = false

  const api: AgentEval = {
    version: 1,
    async prepare(input) {
      if (prepared) throw new Error('PREPARE_ALREADY_USED')
      assertProjectId(input.projectId)
      if (!Array.isArray(input.files)) throw new Error('INVALID_WORKSPACE_FILES')

      for (const file of input.files) {
        const path = normalizePath(file.path)
        const response = await fetch(file.url)
        if (!response.ok) throw new Error(`WORKSPACE_FETCH_FAILED:${response.status}`)
        const blob = await response.blob()
        if (file.sha256 && (await sha256(blob)) !== file.sha256.toLowerCase()) {
          throw new Error(`WORKSPACE_CHECKSUM_MISMATCH:${path}`)
        }
        const target = fileSystemService.paths.join(
          fileSystemService.paths.getProjectPath(input.projectId),
          path,
        )
        const parent = fileSystemService.paths.dirname(target)
        if (parent) await fileSystemService.createDirectory(parent)
        await fileSystemService.writeFile(target, blob)
      }

      prepared = true
      await router.push(`/editor/${input.projectId}`)
      await waitUntil(
        () =>
          Boolean(
            store.isProjectSettingsReady &&
              store.isProjectTimelineReady &&
              store.agentReady &&
              !store.agentHistoryLoading,
          ),
        DEFAULT_TIMEOUT_MS,
      )
      return {
        projectId: input.projectId,
        sessionId: store.agentSessionId,
        snapshot: createSnapshot(store),
      }
    },
    async send(text) {
      if (!text.trim()) throw new Error('EMPTY_AGENT_MESSAGE')
      store.setAgentDraftText(text)
      if (String(store.agentDraft?.text ?? '') !== text) {
        throw new Error(
          `AGENT_DRAFT_NOT_UPDATED:editable=${String(store.agentDraftEditable)}:text=${String(store.agentDraft?.text)}`,
        )
      }
      for (let attempt = 0; attempt < 100 && !store.agentDraftSendable; attempt += 1) {
        await new Promise((resolve) => setTimeout(resolve, 10))
      }
      const pending = store.sendAgentDraft()
      let submissionResult: boolean | undefined
      void pending.then((value) => {
        submissionResult = value
      })
      let turnId: string | null = null
      for (let attempt = 0; attempt < 100; attempt += 1) {
        try {
          turnId = lastMessageId(store)
          break
        } catch {
          await new Promise((resolve) => setTimeout(resolve, 10))
        }
      }
      if (!turnId) {
        void pending
        throw new Error(
          `AGENT_TURN_NOT_CREATED:result=${String(submissionResult)}:ready=${String(store.agentReady)}:historyLoading=${String(store.agentHistoryLoading)}:busy=${String(store.agentBusy)}:pending=${String(Boolean(store.agentPendingInteraction))}:draftSendable=${String(store.agentDraftSendable)}:draftSubmitting=${String(store.agentDraft?.submitting)}:draftEditable=${String(store.agentDraftEditable)}`,
        )
      }
      void pending
      return { turnId }
    },
    async answer(text) {
      const interaction = store.agentPendingInteraction as { interaction_id?: string } | null
      if (!interaction?.interaction_id) throw new Error('NO_PENDING_INTERACTION')
      const pending = store.answerAgentQuestion(text)
      const turnId = interaction.interaction_id
      void pending
      return { turnId }
    },
    async wait(turnId, options = {}) {
      const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS
      const startedAt = Date.now()
      while (Date.now() - startedAt < timeoutMs) {
        const pending = store.agentPendingInteraction as { interaction_id?: string } | null
        if (pending?.interaction_id) {
          return { turnId, status: 'waiting_user', snapshot: createSnapshot(store) }
        }
        if (!store.agentBusy) {
          const modelCall = store.agentModelCall as { status?: string; error?: string } | null
          const status = modelCall?.status
          const resultStatus =
            status === 'failed'
              ? 'failed'
              : status === 'cancelled'
                ? 'cancelled'
                : status === 'completed'
                  ? 'completed'
                  : 'unknown'
          return {
            turnId,
            status: resultStatus,
            snapshot: createSnapshot(store),
            ...(modelCall?.error ? { error: modelCall.error } : {}),
          }
        }
        await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS))
      }
      return { turnId, status: 'timeout', snapshot: createSnapshot(store) }
    },
    async snapshot() {
      return createSnapshot(store)
    },
    async stop() {
      store.stopAgent()
    },
  }

  window.agentEval = api
  return api
}

async function waitUntil(predicate: () => boolean, timeoutMs: number): Promise<void> {
  const startedAt = Date.now()
  while (!predicate()) {
    if (Date.now() - startedAt >= timeoutMs) throw new Error('PREPARE_TIMEOUT')
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS))
  }
}

export { installBrowserHarness }
