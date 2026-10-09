import type { Completion, StreamParams, ToolCall } from './transport/AgentClient'
import type { ToolResult } from './tools/types'

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

/** 一次未完成工具执行的归属和提交状态；结果写入消息后从执行字典移除。 */
export type ToolExecution = {
  startedAt?: string
  resultSpanId?: string
  userId: string
  projectId: string
  sessionId: string
  modelCallId: string
  // 工具结果提交和 UI 进度投影对应的助手消息，不依赖最近一次 modelCall。
  assistantMessageId: string
  call: ToolCall
  status: 'pending' | 'completed' | 'failed' | 'cancelled'
  result: ToolResult | null
}

/** 一次模型调用的快照与终态；工具执行及后续调用不属于这一 modelCall。 */
export type ModelCall = {
  id: string
  status: 'running' | 'completed' | 'cancelled' | 'failed'
  sessionId: string
  userId: string
  projectId: string
  // 触发本轮的用户消息或工具结果消息 ID，每次续轮都重新关联输入。
  inputMessageId: string
  assistantMessageId: string
  request: StreamParams
  completion: Completion | null
  error: string | null
}

/** 一个本地会话的实际内容；运行控制器不落盘，也不随展示选择迁移。 */
export type AgentSession = {
  id: string
  userId: string
  projectId: string
  createdAt: string
  updatedAt: string
  messages: AgentMessage[]
  latestModelCall: ModelCall | null
  toolExecutions: Record<string, ToolExecution>
}

export function getMessageTextParts(message: AgentMessage): TextPart[] {
  return message.parts.filter((part): part is TextPart => part.type === MessagePartType.TEXT)
}
