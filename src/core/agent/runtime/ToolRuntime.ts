import Ajv from 'ajv'
import definitions from './toolDefinitions.json'
import type { ModelTool, ToolCall } from '../transport/AgentClient'
import type { ToolExecutionContext, ToolResult } from '../tools/types'
import { describeItemProperties, type ItemPropertyRequest } from '../services/itemPropertyService'

/** 前端维护的公开工具契约，模型和本地校验共享同一份 schema。 */
export const agentTools: ModelTool[] = definitions.tools
export const toolContractVersion = definitions.contractVersion

/** 创建工具运行时，执行器按需加载。 */
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
   * 校验参数并复核取消和归属，再调用执行器；工具成功/失败由返回的 ToolResult 表达。
   * 属性说明走独立鉴权 HTTP 服务，其他工具延迟加载，复用原编辑及撤销命令。
   * 异常交由 Agent 循环保存为配对错误结果；适配器不自行续轮或重试执行。
   */
  async function execute(call: ToolCall, context: ToolExecutionContext): Promise<ToolResult> {
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
    const tools = await import('../tools')
    // 加载期间可能停止工具、清理会话或切换身份，实际执行前再次检查。
    context.signal.throwIfAborted()
    if (!context.isCurrent()) throw new Error('TOOL_CONTEXT_EXPIRED')
    return tools.executeTool(call.name, call.args, context)
  }

  return { validate, execute }
}
