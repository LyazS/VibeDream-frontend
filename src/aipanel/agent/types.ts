export enum AgentMessageRole {
  USER = 'user',
  ASSISTANT = 'assistant',
}

export enum MessagePartType {
  TEXT = 'text',
  IMAGE = 'image',
  BACKGROUND_CONTEXT = 'background_context',
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

export interface BackgroundContextPart {
  type: MessagePartType.BACKGROUND_CONTEXT
  text: string
}

export interface ToolCallPart {
  type: MessagePartType.TOOL_CALL
  tool_call_id: string
  tool_name: string
  args: Record<string, unknown>
  status: ToolCallStatus
}

export type AgentMessagePart = TextPart | ImagePart | BackgroundContextPart | ToolCallPart

export interface AgentMessage {
  id: string
  role: AgentMessageRole | 'tool'
  parts: AgentMessagePart[]
  created_at: string
  toolCallId?: string
  toolName?: string
  interaction?: SessionInteractionRecord
}

export type InteractionKind = 'ask_user'

export type InteractionSubmittedVia = 'option' | 'custom_input'

/** 当前会话中的交互请求；不属于后端中断协议。 */
export interface InteractiveInterrupt {
  interaction_id: string
  kind: InteractionKind
  prompt: string
  options: string[]
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

export function getMessageTextParts(message: AgentMessage): TextPart[] {
  return message.parts.filter((part): part is TextPart => part.type === MessagePartType.TEXT)
}
