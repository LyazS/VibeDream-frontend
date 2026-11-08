import { isRef, toRaw } from 'vue'
import router from '@/router'
import { fileSystemService } from '@/core/managers'
import { useUnifiedStore } from '@/core/unifiedStore'
import type { EvalSnapshot, AgentEval } from '@/types/global'
import type { EvalIndexWarmupResult } from '@/types/global'
import { verifyOnnxWasmAssets } from '@/core/onnx/loader'
import { verifyTransNetV2Backend } from '@/core/utils/transnetv2/modelRunner'

const DEFAULT_TIMEOUT_MS = 120_000
const POLL_INTERVAL_MS = 50
const WARMUP_MEDIA_TIMEOUT_MS = 600_000
const WARMUP_PREFLIGHT_TIMEOUT_MS = 60_000

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  let timer: number | undefined
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = window.setTimeout(() => reject(new Error(message)), timeoutMs)
      }),
    ])
  } finally {
    if (timer !== undefined) window.clearTimeout(timer)
  }
}

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
      directories: stable(Array.from(store.directories.values())) as unknown[],
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
  root = path,
): Promise<Array<{ path: string; base64: string }>> {
  const entries = await fileSystemService.listDirectory(path)
  const files: Array<{ path: string; base64: string }> = []
  for (const entry of entries) {
    if (entry.kind === 'directory') {
      files.push(...(await collectWorkspaceFiles(entry.path, root)))
      continue
    }
    const relativePath = entry.path.startsWith(`${root}/`)
      ? entry.path.slice(root.length + 1)
      : entry.path
    files.push({
      path: relativePath,
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
    async warmupIndex() {
      if (!prepared) throw new Error('PREPARE_REQUIRED')
      const startedAt = new Date().toISOString()
      const started = Date.now()
      const diagnostics: NonNullable<EvalIndexWarmupResult['diagnostics']> = []
      await withTimeout(
        (async () => {
          await verifyOnnxWasmAssets()
          await verifyTransNetV2Backend()
        })(),
        WARMUP_PREFLIGHT_TIMEOUT_MS,
        `WARMUP_PREFLIGHT_TIMEOUT:${WARMUP_PREFLIGHT_TIMEOUT_MS}`,
      )
      const indexableItems = store.mediaItems.filter(
        (item) => item.mediaType === 'video' || item.mediaType === 'image',
      )
      let indexedCount = 0
      const skippedCount = 0
      let failedCount = 0

      for (const mediaItem of indexableItems) {
        const itemStarted = Date.now()
        try {
          await withTimeout(
            store.ensureMediaIndexing(mediaItem.id),
            WARMUP_MEDIA_TIMEOUT_MS,
            `INDEX_MEDIA_TIMEOUT:${WARMUP_MEDIA_TIMEOUT_MS}`,
          )
          indexedCount += 1
          diagnostics.push({
            mediaId: mediaItem.id,
            stage: 'indexing',
            status: 'completed',
            durationMs: Date.now() - itemStarted,
          })
        } catch (error) {
          failedCount += 1
          const message = error instanceof Error ? error.message : String(error)
          const timedOut = message.startsWith('INDEX_MEDIA_TIMEOUT:')
          if (timedOut) await store.cancelMediaIndexing(mediaItem.id)
          diagnostics.push({
            mediaId: mediaItem.id,
            stage: timedOut ? 'timeout' : 'indexing',
            status: timedOut ? 'timeout' : 'failed',
            durationMs: Date.now() - itemStarted,
            message,
          })
          console.error('[AgentEval] index warmup failed', mediaItem.id, error)
        }
      }

      const completedAt = new Date().toISOString()
      const items = indexableItems.map((mediaItem) => {
        const indexing = mediaItem.metadata?.indexing
        return {
          mediaId: mediaItem.id,
          mediaKind: mediaItem.mediaType as 'video' | 'image',
          indexStatus: indexing?.indexStatus || 'idle',
          ...(indexing?.indexedAt ? { indexedAt: indexing.indexedAt } : {}),
          ...(indexing?.taskId ? { taskId: indexing.taskId } : {}),
          ...(indexing?.assetId ? { assetId: indexing.assetId } : {}),
          ...(indexing?.manifestId ? { manifestId: indexing.manifestId } : {}),
          ...(indexing?.contentSha256 ? { contentSha256: indexing.contentSha256 } : {}),
          ...(indexing?.indexRecipeId ? { indexRecipeId: indexing.indexRecipeId } : {}),
          ...(indexing?.indexVersion ? { indexVersion: indexing.indexVersion } : {}),
          ...(indexing?.segmentPlanHash ? { segmentPlanHash: indexing.segmentPlanHash } : {}),
          ...(indexing?.mediaKind === 'video' && indexing.segmentCount !== undefined
            ? { segmentCount: indexing.segmentCount }
            : {}),
          ...(indexing?.mediaKind === 'video' && indexing.failedSegmentCount !== undefined
            ? { failedSegmentCount: indexing.failedSegmentCount }
            : {}),
          ...(indexing?.summary ? { summary: indexing.summary } : {}),
          ...(indexing?.mediaKind === 'video' && indexing.segmentSummaries
            ? { segmentSummaries: indexing.segmentSummaries }
            : {}),
        }
      })
      const result: EvalIndexWarmupResult = {
        projectId: store.projectId,
        startedAt,
        completedAt,
        durationMs: Date.now() - started,
        indexedCount,
        skippedCount,
        failedCount,
        items,
        diagnostics,
      }
      return result
    },
    async exportWorkspace() {
      if (!prepared) throw new Error('PREPARE_REQUIRED')
      return collectWorkspaceFiles(fileSystemService.paths.getProjectPath(store.projectId))
    },
    async send(text, attachments = []) {
      if (!text.trim() && attachments.length === 0) throw new Error('EMPTY_AGENT_MESSAGE')
      for (const attachment of attachments) {
        const response = await fetch(attachment.url)
        if (!response.ok) throw new Error(`ATTACHMENT_FETCH_FAILED:${response.status}`)
        const blob = await response.blob()
        if (attachment.sha256 && (await sha256(blob)) !== attachment.sha256.toLowerCase()) {
          throw new Error('ATTACHMENT_CHECKSUM_MISMATCH')
        }
        store.addAgentDraftImages([blob])
      }
      store.setAgentDraftText(text)
      const attachmentDeadline = Date.now() + DEFAULT_TIMEOUT_MS
      while (attachments.length > 0) {
        const images = store.agentDraft?.images ?? []
        if (images.some((image) => image.status === 'failed')) throw new Error('ATTACHMENT_PROCESS_FAILED')
        if (images.length >= attachments.length && images.every((image) => image.status === 'ready')) break
        if (Date.now() >= attachmentDeadline) throw new Error('ATTACHMENT_PROCESS_TIMEOUT')
        await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS))
      }
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
