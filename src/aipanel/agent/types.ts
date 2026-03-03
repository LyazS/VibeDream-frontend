// 与后端类型定义完全一致的消息类型
export enum ChatMessageType {
  USER = 'user',
  ASSISTANT = 'assistant', // 直接对应后端的 ASSISTANT
  TOOL = 'tool', // 工具结果消息
}

// 用户消息内容类型
export enum ChatMessageUserContentType {
  TEXT = 'text',
  IMAGE = 'image',
}

// 助手消息内容类型
export enum ChatMessageAssistantContentType {
  TEXT = 'text',
  TOOL_USE = 'tool_use',
  TASK_COMPLETE = 'task_complete', // 任务完成类型
}

// 用户消息内容（对应后端的 ChatMessageUserContent）
export interface ChatMessageUserContent {
  type: ChatMessageUserContentType
  content: string
}

// 助手消息内容（对应后端的 ChatMessageAssistantContent）
export interface ChatMessageAssistantContent {
  type: ChatMessageAssistantContentType
  content: string
}

// 用户消息（对应后端的 ChatMessageUser）
export interface ChatMessageUser {
  id: string
  type: ChatMessageType.USER
  content: ChatMessageUserContent[] // 用户消息内容数组
  timestamp: string // ISO格式时间字符串
}

// 助手消息（对应后端的 ChatMessageAssistant）
export interface ChatMessageAssistant {
  id: string
  type: ChatMessageType.ASSISTANT
  content: ChatMessageAssistantContent[] // 助手消息内容数组
  timestamp: string // ISO格式时间字符串
}

// 工具结果消息（对应后端的 ChatMessageTool）
export interface ChatMessageTool {
  id: string
  type: ChatMessageType.TOOL
  tool_call_id: string // 对应的工具调用 ID
  content: string // 工具执行结果
  timestamp: string // ISO格式时间字符串
}

// 统一的消息类型（联合类型，对应后端的 ChatMessage）
export type ChatMessage = ChatMessageUser | ChatMessageAssistant | ChatMessageTool

// 类型保护函数：判断消息是否为用户消息
export function isUserMessage(message: ChatMessage): message is ChatMessageUser {
  return message.type === ChatMessageType.USER
}

// 类型保护函数：判断消息是否为助手消息
export function isAssistantMessage(message: ChatMessage): message is ChatMessageAssistant {
  return message.type === ChatMessageType.ASSISTANT
}

// 类型保护函数：判断消息是否为工具结果消息
export function isToolMessage(message: ChatMessage): message is ChatMessageTool {
  return message.type === ChatMessageType.TOOL
}

// 会话历史接口（与后端返回格式一致）
export interface ChatHistory {
  id: string
  messages: ChatMessage[]
  createdAt: string
  updatedAt: string
}

// 与后端SessionSummary对应的前端类型
export interface SessionSummary {
  session_id: string
  created_at: string
  updated_at: string
  message_count: number
  preview_text: string
}
