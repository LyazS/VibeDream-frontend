import type { ToolCall } from './transport/AgentClient'
import type { ToolResult } from './tools/types'
import type { AgentUsageRecord } from './runtime/AgentUsage'

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
  QUEUED = 'queued',
  RUNNING = 'running',
  WAITING = 'waiting',
  COMPLETED = 'completed',
  FAILED = 'failed',
  SKIPPED = 'skipped',
  CANCELLED = 'cancelled',
  INTERRUPTED = 'interrupted',
}

export interface TextPart {
  type: MessagePartType.TEXT
  text: string
}

export interface ImagePart {
  type: MessagePartType.IMAGE
  attachmentId: string
}

export type AgentImageMimeType = 'image/png' | 'image/jpeg' | 'image/webp'

export type AgentImageConversionParams = {
  width: number
  height: number
  mimeType: 'image/webp'
  quality: number
}

export type AgentAttachmentScope = {
  userId: string
  projectId: string
}

export type AgentAttachment = AgentAttachmentScope & {
  id: string
  original: {
    relativePath: string
    fileName: string
    mimeType: AgentImageMimeType
    byteSize: number
    width: number
    height: number
  }
  conversionParams: AgentImageConversionParams
}

/** 用户原图的编码结果仅作为可释放的运行时缓存，不写入用户附件记录。 */
export type AgentImage = AgentAttachment & {
  blob: Blob
}

/** 图片记录的存储索引及临时上传缓存，统一限定到账户、工程和会话。 */
export type ProviderUpload = {
  providerId: string
  reference: string
  expiresAt: string
  metadata?: Record<string, unknown>
}

export type AgentAttachmentRecordBase = AgentAttachmentScope & {
  key: string
  owner: string
  sessionKey: string
  id: string
  providerUploads?: Record<string, ProviderUpload>
}

/** 用户附件保留原文件位置，导入素材时仍读取完整原图。 */
export type AgentUserAttachmentRecord = AgentAttachmentRecordBase &
  AgentAttachment & {
    recordKind: 'user_attachment'
  }

/** 工具观察图保存当次编码结果；图片字节及描述完整存入 IndexedDB。 */
export type AgentToolImage = AgentAttachmentScope & {
  recordKind: 'tool_image'
  id: string
  blob: Blob
  description: string
  mimeType: AgentImageMimeType
  byteSize: number
  width: number
  height: number
}

export type AgentToolImageRecord = AgentAttachmentRecordBase & AgentToolImage
export type AgentAttachmentRecord = AgentUserAttachmentRecord | AgentToolImageRecord

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
  reasoning_content?: string
  /** 新助手消息只在模型调用成功后进入历史；旧会话缺失该字段仍可读取。 */
  modelCallStatus?: ModelCallSummary['status']
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
  status: `${ToolCallStatus}`
  result: ToolResult | null
}

/** 最近一次模型调用的轻量摘要；完整请求和响应由云端诊断日志保存。 */
export type ModelCallSummary = {
  id: string
  status: 'running' | 'completed' | 'cancelled' | 'failed'
  // 触发本轮的用户消息或工具结果消息 ID，每次续轮都重新关联输入。
  inputMessageId: string
  assistantMessageId: string
  error: string | null
  errorCode?: string
}

/** 一个本地会话的实际内容；运行控制器不落盘，也不随展示选择迁移。 */
export type AgentSession = {
  id: string
  userId: string
  projectId: string
  createdAt: string
  updatedAt: string
  messages: AgentMessage[]
  latestModelCall: ModelCallSummary | null
  usageRecords: Record<string, AgentUsageRecord>
  toolExecutions: Record<string, ToolExecution>
}

export function getMessageTextParts(message: AgentMessage): TextPart[] {
  return message.parts.filter((part): part is TextPart => part.type === MessagePartType.TEXT)
}
