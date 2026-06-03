import type {
  InteractionResultRequest,
  SessionSnapshot,
  StartRunRequest,
  ToolResultRequest,
} from '@/aipanel/agent/types'

export const API_ENDPOINTS = {
  createSession: '/api/agent/sessions',
  sessionSnapshot: (sessionId: string) => `/api/agent/sessions/${sessionId}`,
  startRun: (sessionId: string) => `/api/agent/sessions/${sessionId}/runs`,
  submitToolResult: (sessionId: string, runId: string) =>
    `/api/agent/sessions/${sessionId}/runs/${runId}/tool-results`,
  submitInteractionResult: (sessionId: string, runId: string) =>
    `/api/agent/sessions/${sessionId}/runs/${runId}/interaction-results`,
} as const

export interface CreateSessionResponse {
  session_id: string
  created_at: string
}

export type SessionSnapshotResponse = SessionSnapshot

export type StartRunPayload = StartRunRequest

export type SubmitToolResultPayload = ToolResultRequest

export type SubmitInteractionResultPayload = InteractionResultRequest

export interface ApiError {
  detail: string
  status_code?: number
}
