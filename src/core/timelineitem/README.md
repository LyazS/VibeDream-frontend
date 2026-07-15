# timelineitem 模块整理说明

`timelineitem` 负责描述时间轴片段本身，不再把所有类型、运行时逻辑和 UI 派生逻辑平铺在同一层。

## 目录约定

- `model/`
  - 放纯数据结构、类型定义、常量。
  - 不放依赖 store、渲染器、UI 的逻辑。
- `features/`
  - 放片段能力域逻辑，例如 `transition`、`filter`、`mask`。
  - 每个文件尽量自包含，暴露 `normalize`、`supports`、`runtime` 一类能力。
- `runtime/`
  - 放片段实例生命周期相关逻辑，例如 `factory`、`textRebuild`。
  - 允许依赖 `bunny`、bitmap、初始化流程。
- `ui/`
  - 放面向界面展示的派生逻辑，例如状态文案、overlay view model。
- 顶层兼容文件
  - 仅保留 re-export，用于渐进迁移旧 import。
  - 新代码优先直接从子目录引用。

## 文件放置建议

- 新增基础类型：优先放 `model/`
- 新增滤镜/转场/mask 规则：优先放 `features/`
- 新增片段创建、重建、恢复流程：优先放 `runtime/`
- 新增状态展示或时间轴展示派生：优先放 `ui/`

## 迁移原则

- 先整理结构，再逐步迁移调用方 import。
- 顶层文件不再承载真实实现，避免继续“越堆越平”。
