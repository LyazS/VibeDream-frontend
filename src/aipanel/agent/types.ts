export enum AgentMessageRole {
  USER = 'user',
  ASSISTANT = 'assistant',
  TOOL = 'tool',
}

export enum MessagePartType {
  TEXT = 'text',
  IMAGE = 'image',
  TOOL_CALL = 'tool_call',
  TOOL_RESULT = 'tool_result',
}

export enum ToolCallStatus {
  REQUESTED = 'requested',
  COMPLETED = 'completed',
  FAILED = 'failed',
}

export interface TextPart {
  type: MessagePartType.TEXT
  text: string
}

export interface ImagePart {
  type: MessagePartType.IMAGE
  url: string
}

export interface ToolCallPart {
  type: MessagePartType.TOOL_CALL
  tool_call_id: string
  tool_name: string
  args: Record<string, unknown>
  status: ToolCallStatus
}

export interface ToolResultPart {
  type: MessagePartType.TOOL_RESULT
  tool_call_id: string
  output: string
  is_error: boolean
}

export type AgentMessagePart = TextPart | ImagePart | ToolCallPart | ToolResultPart

export interface AgentMessage {
  id: string
  role: AgentMessageRole
  parts: AgentMessagePart[]
  created_at: string
}

export interface FrontendToolInterrupt {
  type: 'frontend_tool'
  tool_call_id: string
  tool_name: string
  args: Record<string, unknown>
}

export enum RunStatus {
  RUNNING = 'running',
  PAUSED = 'paused',
  COMPLETED = 'completed',
  FAILED = 'failed',
}

export interface PendingRun {
  run_id: string
  status: RunStatus
  interrupt?: FrontendToolInterrupt | null
}

export interface SessionSummary {
  session_id: string
  created_at: string
  updated_at: string
  message_count: number
  preview_text: string
}

export interface SessionHistory {
  id: string
  messages: AgentMessage[]
  createdAt: string
  updatedAt: string
}

export interface RunInput {
  parts: Array<TextPart | ImagePart>
}

export interface StartRunRequest {
  input: RunInput
}

export interface ToolResultRequest {
  tool_call_id: string
  output: string
  is_error: boolean
}

export interface SessionSnapshot {
  session: {
    session_id: string
    created_at: string
    updated_at: string
  }
  messages: AgentMessage[]
  pending_run: PendingRun | null
}

export interface RunStartedEvent {
  type: 'run.started'
  run_id: string
  session_id: string
}

export interface MessageDeltaEvent {
  type: 'message.delta'
  run_id: string
  message_id: string
  part_index: number
  delta: string
}

export interface MessageCompletedEvent {
  type: 'message.completed'
  run_id: string
  message: AgentMessage
}

export interface RunPausedEvent {
  type: 'run.paused'
  run_id: string
  reason: 'frontend_tool'
  tool_call_id: string
  tool_name: string
  args: Record<string, unknown>
}

export interface RunCompletedEvent {
  type: 'run.completed'
  run_id: string
  message_id?: string | null
  output_text: string
}

export interface RunFailedEvent {
  type: 'run.failed'
  run_id: string
  error_code: string
  detail: string
  retryable: boolean
}

export type AgentStreamEvent =
  | RunStartedEvent
  | MessageDeltaEvent
  | MessageCompletedEvent
  | RunPausedEvent
  | RunCompletedEvent
  | RunFailedEvent

export function isUserMessage(message: AgentMessage): boolean {
  return message.role === AgentMessageRole.USER
}

export function isAssistantMessage(message: AgentMessage): boolean {
  return message.role === AgentMessageRole.ASSISTANT
}

export function isPublicMessage(message: AgentMessage): boolean {
  return isUserMessage(message) || isAssistantMessage(message)
}

export function getMessageTextParts(message: AgentMessage): TextPart[] {
  return message.parts.filter((part): part is TextPart => part.type === MessagePartType.TEXT)
}
