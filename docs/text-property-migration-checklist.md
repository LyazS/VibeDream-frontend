# Text Property Migration Checklist

## 目标

这份清单用于记录 `text` 域在 clip property system 中的迁移状态，避免后续继续推进时反复人工确认：

- 哪些属性已经迁入新链路
- 哪些字段仍未迁移
- 哪些字段虽然类型存在，但当前没有真实 UI 入口

当前范围仅覆盖 `LightCut-frontend/src/components/properties/groups/TextPropertiesGroup.vue` 中的用户可达属性入口，以及 `TextStyleConfig` 中声明的文本样式字段。

## 当前新链路

当前已迁移的 `text` 属性统一走：

`TextPropertiesGroup -> propertyMutationCommitter.commitDirect(...) -> PropertyPlanner -> text-rebuild -> ApplyChangePlanCommand`

约束：

- 只支持 direct commit
- 不接入 defer / transient overlay
- 不接入 keyframe toggle
- 文本相关运行时重建统一通过 `text-rebuild`

## 已迁移属性

### 内容

- `text.content`

### 基础字体样式

- `text.style.fontSize`
- `text.style.fontFamily`
- `text.style.fontWeight`
- `text.style.fontStyle`

### 颜色与布局

- `text.style.color`
- `text.style.backgroundColor`
- `text.style.textAlign`

### 效果样式

- `text.style.textShadow`
- `text.style.textStroke`
- `text.style.textGlow`

## 已迁移入口说明

下列 `TextPropertiesGroup` 用户入口已接入新链路：

- 文本内容输入框
- 字号 slider / number input
- 字体 family select
- 字重 select
- italic select
- 文字颜色 picker
- 背景色 picker
- 背景色开关
- 文本对齐按钮组
- 阴影开关 / 颜色 / blur / offsetX / offsetY
- 描边开关 / 宽度 / 颜色
- 发光开关 / 颜色 / blur / spread

## 未迁移字段

以下字段在 `TextStyleConfig` 中存在，但当前未接入 property system：

- `text.style.lineHeight`
- `text.style.maxWidth`
- `text.style.customFont`

这些字段当前不应被误标记为“已迁移”。

## 当前无真实 UI 入口

以下字段虽然存在于 `TextStyleConfig`，但当前 `TextPropertiesGroup` 中没有明确的用户可达编辑入口：

- `lineHeight`
- `maxWidth`
- `customFont`

因此它们更适合在后续“新增 UI + 同步接 property system”时一起处理，而不是只补 schema 不补真实入口。

## 已完成收口

- `TextPropertiesGroup` 中旧的 `updateTextStyle(...)` 过渡入口已删除
- `TextPropertiesGroup` 中 `throwClipPropertyPhase0Todo('text.style.update')` 已删除
- 当前已有 UI 的 text 属性入口，不再依赖旧的样式更新 TODO

## 后续建议顺序

1. 如果要继续扩 `text` 域，优先决定是否真的需要给 `lineHeight / maxWidth / customFont` 增加 UI。
2. 如果不准备增加 UI，这三个字段应保持“未迁移但当前无入口”的状态。
3. 如果后续新增 text 样式属性，优先沿用现有样板：
   `schema -> planner -> text-rebuild -> TextPropertiesGroup direct commit`
4. 在开始 text defer 设计前，先保持当前 direct commit 路径稳定，不要提前引入 overlay。
