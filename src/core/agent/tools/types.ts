/**
 * 工具执行类型定义
 * 在工具运行时和工具实现之间共享
 */

/** 单次工具执行上下文，固定调用标识、执行归属及取消信号。 */
export interface ToolExecutionContext {
  /** 模型生成的工具调用 ID，关联结果、进度展示和取消操作。 */
  toolCallId: string
  /** 发起本次调用的用户 ID，作为执行归属快照的一部分，用于判断账户是否已经变化。 */
  userId: string
  /** 本次调用所属的编辑工程 ID，用于记录工程归属，避免把旧工程的结果用于新工程。 */
  projectId: string
  /** 本次调用所属的聊天会话 ID；新建或清理聊天后会更换，用于隔离旧会话的迟到结果。 */
  sessionId: string
  /** 产生本次工具调用的模型调用 ID；每次调用模型都生成新的 ID。 */
  modelCallId: string
  /** 工具取消信号；会话清理时触发，停止 Agent 时也会取消素材读取/检索。 */
  signal: AbortSignal
  /** 实时检查执行归属及工具取消状态。 */
  isCurrent: () => boolean
}

export interface ToolDefinition {
  name: string
  execute: (args: Record<string, unknown>, context: ToolExecutionContext) => Promise<ToolResult>
}

export interface ToolResult {
  success: boolean
  output: string
  error?: string
}
