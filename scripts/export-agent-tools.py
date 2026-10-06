"""从原 Python 注册表导出工具契约，不加载旧服务及其运行时依赖。"""

import argparse
import ast
import json
from pathlib import Path


def literal(node, constants):
    """解析声明中的字面量和共享 schema 常量；遇到动态表达式立即报错。"""
    class ResolveConstants(ast.NodeTransformer):
        def visit_Name(self, value):
            if value.id not in constants:
                raise ValueError(f"未知 schema 常量: {value.id}")
            return ast.parse(repr(constants[value.id]), mode="eval").body

    return ast.literal_eval(ResolveConstants().visit(node))


def export_tools():
    """按 BUILTIN_TOOL_TYPES 顺序读取完整名称、说明和参数，排除未迁移的帧检查。"""
    root = Path(__file__).resolve().parents[2]
    builtin = root / "backend/services/agent/tools/builtin"
    registry = ast.parse((builtin / "__init__.py").read_text())
    modules = {
        item.name: statement.module
        for statement in registry.body
        if isinstance(statement, ast.ImportFrom) and statement.module
        for item in statement.names
    }
    names = next(
        statement.value.elts
        for statement in registry.body
        if isinstance(statement, ast.AnnAssign)
        and statement.target.id == "BUILTIN_TOOL_TYPES"
    )
    def load_constants(module):
        """读取声明文件及其相对导入的静态共享常量，不执行模块。"""
        source = ast.parse((builtin / f"{module}.py").read_text())
        constants = {}
        for statement in source.body:
            if isinstance(statement, ast.ImportFrom) and statement.level == 1:
                imported = load_constants(statement.module)
                for item in statement.names:
                    if item.name in imported:
                        constants[item.asname or item.name] = imported[item.name]
            if isinstance(statement, ast.Assign):
                try:
                    value = literal(statement.value, constants)
                except (ValueError, TypeError):
                    continue
                for target in statement.targets:
                    if isinstance(target, ast.Name):
                        constants[target.id] = value
        return constants

    tools = []
    for name in names:
        if name.id == "InspectTimelineFramesTool":
            continue
        source = ast.parse((builtin / f"{modules[name.id]}.py").read_text())
        constants = load_constants(modules[name.id])
        declaration = next(
            item for item in source.body
            if isinstance(item, ast.ClassDef) and item.name == name.id
        )
        tool = {}
        for method in declaration.body:
            if isinstance(method, ast.FunctionDef) and method.name in (
                "name", "description", "parameters"
            ):
                returns = [item for item in method.body if isinstance(item, ast.Return)]
                if len(returns) != 1:
                    raise ValueError(f"{name.id}.{method.name} 不是静态声明")
                tool[method.name] = literal(returns[0].value, constants)
        if set(tool) != {"name", "description", "parameters"}:
            raise ValueError(f"工具声明不完整: {name.id}")
        tools.append(tool)
    return {"contractVersion": "editor-tools-v1", "tools": tools}


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--check", action="store_true")
    args = parser.parse_args()
    target = Path(__file__).resolve().parents[1] / "src/aipanel/agent/runtime/toolDefinitions.json"
    data = export_tools()
    if args.check:
        if json.loads(target.read_text()) != data:
            raise SystemExit("工具契约已变化，请运行 npm run generate:agent-tools")
    else:
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n")
    print(f"工具契约校验通过：{len(data['tools'])} 个工具")
