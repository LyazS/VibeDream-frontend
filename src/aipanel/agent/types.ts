export enum AgentMessageRole {
  USER = 'user',
  ASSISTANT = 'assistant',
}

export enum MessagePartType {
  TEXT = 'text',
  IMAGE = 'image',
  TOOL_CALL = 'tool_call',
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

export type AgentMessagePart = TextPart | ImagePart | ToolCallPart

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

export type InteractionKind = 'ask_user'

export type InteractionSubmittedVia = 'option' | 'custom_input'

export interface InteractiveInterrupt {
  type: 'interactive_interrupt'
  interaction_id: string
  kind: InteractionKind
  prompt: string
  options: string[]
  placeholder: string
  created_at: string
}

export interface InteractionResult {
  interaction_id: string
  kind: InteractionKind
  answer: string
  submitted_via: InteractionSubmittedVia
  submitted_at: string
}

export interface SessionInteractionRecord {
  interrupt: InteractiveInterrupt
  result: InteractionResult | null
}

export interface AskUserToolArgs {
  question: string
  suggested_options?: string[]
  placeholder?: string
}

export type PendingInterrupt = FrontendToolInterrupt | InteractiveInterrupt

export enum RunStatus {
  RUNNING = 'running',
  PAUSED = 'paused',
  COMPLETED = 'completed',
  FAILED = 'failed',
  CANCELLED = 'cancelled',
}

export interface PendingRun {
  run_id: string
  status: RunStatus
  interrupt?: PendingInterrupt | null
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

export interface InteractionResultRequest {
  interaction_id: string
  answer: string
  submitted_via: InteractionSubmittedVia
}

export interface CancelRunRequest {
  reason: string
  pending_tool_call_id?: string | null
}

export interface SessionSnapshot {
  session: {
    session_id: string
    created_at: string
    updated_at: string
  }
  messages: AgentMessage[]
  interactions: SessionInteractionRecord[]
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
  reason: 'frontend_tool' | 'interaction'
  interrupt: PendingInterrupt
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

export function isInteractiveInterrupt(
  interrupt: PendingInterrupt | null | undefined,
): interrupt is InteractiveInterrupt {
  return interrupt?.type === 'interactive_interrupt'
}

export function isFrontendToolInterrupt(
  interrupt: PendingInterrupt | null | undefined,
): interrupt is FrontendToolInterrupt {
  return interrupt?.type === 'frontend_tool'
}
