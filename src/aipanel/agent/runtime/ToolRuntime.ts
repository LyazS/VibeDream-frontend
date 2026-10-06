import Ajv from 'ajv'
import definitions from './toolDefinitions.json'
import type { ModelTool, ToolCall } from '../transport/AgentClient'
import type { ToolResult } from '../composables/core/toolTypes'
import { describeItemProperties, type ItemPropertyRequest } from '../services/itemPropertyService'

/** 固定工具归属，signal 和 isCurrent 检查会话清理；普通停止 Agent 不取消已开始的工具。 */
export type ToolContext = {
  userId: string
  projectId: string
  sessionId: string
  turnId: string
  signal: AbortSignal
  isCurrent: () => boolean
}

/** 前端公开工具契约；由原 Python 注册表生成，模型和本地校验共享同一份 schema。 */
export const agentTools: ModelTool[] = definitions.tools
export const toolContractVersion = definitions.contractVersion

/** 创建独立工具适配器，原执行器在执行时加载，不初始化旧会话管理器。 */
export function createToolRuntime() {
  const ajv = new Ajv({ allErrors: true, strict: false })
  const validators = new Map(agentTools.map((tool) => [tool.name, ajv.compile(tool.parameters)]))

  /** 使用原 schema 校验参数，不转换类型或填默认值；异常由 Agent 循环转为工具错误结果。 */
  function validate(call: ToolCall) {
    const validator = validators.get(call.name)
    if (!validator) throw new Error(`TOOL_NOT_FOUND: ${call.name}`)
    if (!validator(call.args))
      throw new Error(`TOOL_ARGUMENTS_INVALID: ${ajv.errorsText(validator.errors)}`)
  }

  /**
   * 校验参数并复核取消和归属，再调用原执行器；工具成功/失败由返回的 ToolResult 表达。
   * 属性说明走独立鉴权 HTTP 服务，其他工具延迟加载，复用原编辑及撤销命令。
   * 异常交由 Agent 循环保存为配对错误结果；适配器不自行续轮或重试执行。
   */
  async function execute(call: ToolCall, context: ToolContext): Promise<ToolResult> {
    validate(call)
    context.signal.throwIfAborted()
    if (!context.isCurrent()) throw new Error('TOOL_CONTEXT_EXPIRED')
    if (call.name === 'describe_item_property') {
      const response = await describeItemProperties(call.args as unknown as ItemPropertyRequest, {
        signal: context.signal,
      })
      const data = response.data
      return { success: !data.error, output: JSON.stringify(data, null, 2), error: data.error }
    }
    const tools = await import('../composables/tools')
    // 加载期间可能清理会话或切换身份，实际执行前再次检查；普通停止允许已开始的工具完成。
    context.signal.throwIfAborted()
    if (!context.isCurrent()) throw new Error('TOOL_CONTEXT_EXPIRED')
    return tools.executeTool(call.name, call.args, { ...context, toolCallId: call.id })
  }

  return { validate, execute }
}
