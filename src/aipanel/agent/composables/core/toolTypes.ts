/**
 * 工具执行类型定义
 * 在工具运行时和工具实现之间共享
 */

/** 工具执行上下文，记录本次调用的归属；字段可选，以兼容未传上下文的原工具调用。 */
export interface ToolExecutionContext {
  /** 模型生成的工具调用 ID，用于关联调用与结果，以及对应工具的进度展示和取消操作。 */
  toolCallId?: string
  /** 发起本次调用的用户 ID，作为执行归属快照的一部分，用于判断账户是否已经变化。 */
  userId?: string
  /** 本次调用所属的编辑工程 ID，用于记录工程归属，避免把旧工程的结果用于新工程。 */
  projectId?: string
  /** 本次调用所属的聊天会话 ID；新建或清理聊天后会更换，用于隔离旧会话的迟到结果。 */
  sessionId?: string
  /** 产生本次工具调用的模型调用 ID；同一会话中，工具结果续轮后会产生新的 turn ID。 */
  turnId?: string
  /** 工具的取消信号，会话清理时触发；普通停止 Agent 不触发，以便保存已开始工具的结果。 */
  signal?: AbortSignal
  /** 实时检查执行归属；账户、工程或会话失效后返回 false，普通停止仍允许同一工具完成。 */
  isCurrent?: () => boolean
}

export interface ToolDefinition {
  name: string
  execute: (args: Record<string, any>, context?: ToolExecutionContext) => Promise<ToolResult>
}

export interface ToolResult {
  success: boolean
  output: string
  error?: string
}
