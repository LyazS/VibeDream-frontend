/**
 * 前端工具注册系统
 * 管理前端可执行的工具
 */

export interface ToolDefinition {
  name: string
  description: string
  parameters: Record<string, any>
  execute: (args: Record<string, any>) => Promise<string>
}

export interface ToolResult {
  success: boolean
  result: string
  error?: string
}

class ToolRegistry {
  private tools: Map<string, ToolDefinition> = new Map()

  register(tool: ToolDefinition): void {
    this.tools.set(tool.name, tool)
  }

  get(name: string): ToolDefinition | undefined {
    return this.tools.get(name)
  }

  has(name: string): boolean {
    return this.tools.has(name)
  }

  listAll(): ToolDefinition[] {
    return Array.from(this.tools.values())
  }

  /**
   * 执行工具
   */
  async execute(name: string, args: Record<string, any>): Promise<ToolResult> {
    const tool = this.tools.get(name)
    if (!tool) {
      return {
        success: false,
        result: '',
        error: `未找到工具: ${name}`,
      }
    }

    try {
      const result = await tool.execute(args)
      return { success: true, result }
    } catch (error: any) {
      return {
        success: false,
        result: '',
        error: error.message,
      }
    }
  }
}

export const toolRegistry = new ToolRegistry()
