/**
 * 全局类型声明文件
 * 为全局对象和扩展提供类型定义
 */

import type { TimelineItemDragData, MediaItemDragData } from './index'

export type EvalTurnStatus =
  | 'completed'
  | 'waiting_user'
  | 'failed'
  | 'cancelled'
  | 'timeout'
  | 'unknown'

export interface EvalSnapshot {
  project: {
    config: unknown
    tracks: unknown[]
    timelineItems: unknown[]
    mediaItems: unknown[]
  }
  agent: {
    sessionId: string | null
    messages: unknown[]
    toolExecutions: unknown
    pendingInteraction: unknown
    latestModelCall: unknown
    usage: unknown
    connection: unknown
    ready: boolean
    historyLoading: boolean
    draftSendable: boolean
    draftSubmitting: boolean
    draftEditable: boolean
  }
}

export interface EvalTurnResult {
  turnId: string
  status: EvalTurnStatus
  snapshot: EvalSnapshot
  error?: string
}

export interface EvalIndexManifestItem {
  mediaId: string
  mediaKind: 'video' | 'image'
  indexStatus: string
  indexedAt?: string
  taskId?: string
  assetId?: string
  manifestId?: string
  contentSha256?: string
  indexRecipeId?: string
  indexVersion?: string
  segmentPlanHash?: string
  segmentCount?: number
  failedSegmentCount?: number
  summary?: unknown
  segmentSummaries?: unknown[]
  resultSummary?: unknown
}

export interface EvalIndexWarmupResult {
  projectId: string
  startedAt: string
  completedAt: string
  durationMs: number
  indexedCount: number
  skippedCount: number
  failedCount: number
  items: EvalIndexManifestItem[]
  diagnostics?: EvalWarmupDiagnostic[]
}

export interface EvalWarmupDiagnostic {
  mediaId?: string
  stage: string
  status: 'completed' | 'skipped' | 'failed' | 'timeout'
  durationMs: number
  message?: string
}

export interface AgentEval {
  version: 1
  prepare(input: {
    projectId: string
    files: Array<{ path: string; url: string; sha256?: string }>
  }): Promise<{ projectId: string; sessionId: string; snapshot: EvalSnapshot }>
  warmupIndex(): Promise<EvalIndexWarmupResult>
  exportWorkspace(): Promise<Array<{ path: string; base64: string }>>
  send(text: string): Promise<{ turnId: string }>
  answer(text: string): Promise<{ turnId: string }>
  wait(turnId: string, options?: { timeoutMs?: number }): Promise<EvalTurnResult>
  snapshot(): Promise<EvalSnapshot>
  stop(): Promise<void>
}

// 扩展 Window 接口，添加拖拽数据属性和 File System Access API
declare global {
  interface Window {
    agentEval?: AgentEval
    __timelineDragData?: TimelineItemDragData | null
    __mediaDragData?: MediaItemDragData | null
    showSaveFilePicker?: (options?: SaveFilePickerOptions) => Promise<FileSystemFileHandle>
  }

  // File System Access API 类型定义
  interface SaveFilePickerOptions {
    suggestedName?: string
    types?: Array<{
      description?: string
      accept: Record<string, string[]>
    }>
    excludeAcceptAllOption?: boolean
  }

  interface FileSystemFileHandle {
    createWritable(): Promise<FileSystemWritableFileStream>
  }

  interface FileSystemWritableFileStream {
    write(data: Blob | BufferSource | string): Promise<void>
    close(): Promise<void>
  }
}

// 确保这个文件被视为模块
export {}
