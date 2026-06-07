# LightCut Frontend 片段属性系统重构方案

## 1. 背景与问题定义

当前片段属性系统的主要问题，不是单点实现不优雅，而是多个职责同时在修改同一份状态：

- UI / composable 直接修改 `timelineItem.config`
- `useHistoryOperations` 同时承担校验、分流、命令组装
- `command` 层一部分只做代理，一部分直接写模型
- `defer` 交互通过临时污染 `item.config` / `item.animation` / `item.filterEffect` 实现预览
- 渲染链路读取 `runtime.renderConfig || config`，但没有正式建模“交互态渲染覆盖”

结果是：

- 同一属性存在多条写入路径
- 历史、交互、渲染、持久化边界不清
- 新增属性成本高，容易复制旧问题
- `defer` 和 `history`、`render` 之间耦合过重
- 系统缺少唯一的属性语义中心

本方案的目标是对片段属性系统做一次大规模重构，建立清晰的状态分层和统一的属性修改协议。

## 2. 重构目标

### 2.1 核心目标

1. 将 `持久状态`、`渲染状态`、`交互状态` 彻底分离。
2. 建立统一的属性定义中心和唯一属性修改入口。
3. 让 `defer` 不再直接污染持久模型。
4. 让 `history/undo/redo` 针对标准化的变更计划工作，而不是直接绑定具体命令实现细节。
5. 让渲染层只依赖正式的“最终渲染态”，而不是依赖被临时修改过的领域模型。

### 2.2 非目标

以下事项不属于本次重构的第一优先级：

- 改写 WebGL 渲染器内部绘制算法
- 重新设计 `timeline item` 的持久化格式
- 一次性改完所有属性面板 UI 组件

## 3. 设计原则

### 3.1 单一事实来源

每类信息必须有唯一的真相来源：

- 持久属性真相：`UnifiedTimelineItemData`
- 渲染态真相：`RenderStateResolver` 输出
- 交互临时态真相：`InteractionSession`
- 属性语义真相：`PropertySchemaRegistry`

### 3.2 写入路径唯一化

以后不再允许：

- UI 直接写 `item.config`
- `defer` 直接写 `item.animation`
- 某个 command 自己决定属性属于哪类、该写哪里

所有持久属性修改必须经过：

`PropertyMutationService -> ChangePlan -> History Transaction -> Persisted Writer`

所有交互预览修改必须经过：

`InteractionSession -> Transient Overlay -> RenderStateResolver`

### 3.3 渲染与持久化解耦

渲染永远基于“最终渲染态”工作，而不是直接相信 `item.config` 当前就是正确显示值。

### 3.4 新骨架优先，完成后直接切换

本次重构不再以兼容旧实现为目标。

采用策略如下：

- 尽可能新增新目录、新服务、新 command、新 session、新 resolver
- 新骨架一旦具备闭环能力，即直接切换调用路径
- 被替换的旧实现直接删除，而不是长期保留
- 不再为旧接口、旧 command、旧 defer 流程提供兼容层

原因：

- 当前旧系统的混乱来自多套路径并存
- 如果继续兼容旧实现，新架构很容易再次被旧逻辑污染
- 本次重构的目标不是“渐进整理”，而是“重建统一属性系统”

因此，本方案采用：

- `先建立新骨架`
- `再按模块整段替换旧路径`
- `替换后立即删除旧实现`

## 4. 目标分层

建议新增如下逻辑分层：

### 4.1 Domain Model Layer

职责：

- 只承载持久化数据和基础运行时数据
- 不负责属性修改策略
- 不直接暴露给 UI 修改

核心对象：

- `UnifiedTimelineItemData`
- `UnifiedTimelineItemRuntime`
- `ClipFilterConfig`
- `ClipTransitionOutConfig`
- `AnimationProps`

### 4.2 Property Schema Layer

职责：

- 定义每个属性的语义
- 定义属性属于哪类存储
- 定义是否支持动画、defer、批量修改
- 定义对应 writer / resolver / preview 规则

建议目录：

`src/core/property-schema/`

建议核心接口：

```ts
export type PropertyStorageKind =
  | 'config'
  | 'filterEffect'
  | 'transitionOut'
  | 'animation'
  | 'textRuntime'
  | 'composite'

export type DeferredMode =
  | 'none'
  | 'transient-overlay'
  | 'transient-animation-patch'

export interface ClipPropertyDefinition<TValue = unknown> {
  path: string
  storage: PropertyStorageKind
  mediaTypes: Array<'video' | 'image' | 'audio' | 'text'>
  animatable: boolean
  deferredMode: DeferredMode
  writer: string
  reader: string
  equality?: (a: TValue, b: TValue) => boolean
}
```

典型属性定义：

- `transform.position.x`
- `transform.position.y`
- `transform.size.width`
- `transform.opacity`
- `audio.volume`
- `audio.isMuted`
- `filter.intensity`
- `transition.durationFrames`
- `text.content`
- `text.style.fontSize`
- `mask.center.x`

### 4.3 Property Mutation Layer

职责：

- 接收统一属性修改意图
- 基于属性定义和上下文做策略分流
- 生成标准化 `ChangePlan`
- 不直接操作历史模块和 UI

建议目录：

`src/core/property-mutation/`

建议入口接口：

```ts
export interface PropertyChangeIntent<TValue = unknown> {
  timelineItemId: string
  path: string
  value: TValue
  frame?: number
  source: 'ui' | 'preview' | 'ai' | 'system'
}

export interface PropertyMutationContext {
  currentFrame?: number
  mode: 'direct' | 'deferred-commit'
}

export interface ChangePlan {
  type: 'property-change' | 'batch-property-change'
  operations: ChangeOperation[]
  description: string
}
```

此层负责决定：

- 直接写 `config`
- 写 `filterEffect`
- 写 `transitionOut`
- 写 `animation`
- 触发文本重建
- 是否生成 batch plan

### 4.4 History Transaction Layer

职责：

- 执行 `ChangePlan`
- 提供 undo / redo
- 维护历史边界

建议目录：

`src/core/history/`

建议替代方向：

- `ApplyChangePlanCommand`
- `ApplyBatchChangePlanCommand`

命令层以后不再承担属性语义判断，只负责：

- 执行 plan
- 保存执行前快照或 reversible patch
- 撤销恢复

### 4.5 Interaction Session Layer

职责：

- 管理 slider dragging / preview / defer 交互
- 只维护交互期间的临时态
- 不直接修改持久模型

建议目录：

`src/core/interaction-sessions/`

建议对象：

- `TransformInteractionSession`
- `FilterInteractionSession`
- `MaskInteractionSession`
- `TextInteractionSession`

统一接口建议：

```ts
export interface InteractionSession<TPatch = unknown> {
  begin(itemId: string): void
  apply(patch: TPatch): void
  commit(): Promise<void>
  cancel(): void
  isActive(): boolean
}
```

### 4.6 Render State Layer

职责：

- 从持久状态、动画状态、交互临时态解析出最终渲染态
- 为 Preview / WebGL / Overlay 提供统一读取接口

建议目录：

`src/core/render-state/`

建议入口：

```ts
export interface ResolvedRenderState<TConfig = unknown> {
  config: TConfig
  filterEffect?: ClipFilterConfig
}

export interface RenderStateResolver {
  resolve(item: UnifiedTimelineItemData, frame: number): ResolvedRenderState
}
```

## 5. 状态模型重构

### 5.1 现状问题

当前状态混杂在三处：

- `item.config` / `item.filterEffect` / `item.transitionOut` / `item.animation`
- `item.runtime.renderConfig` / `item.runtime.renderFilterEffect`
- `AnimationSession` 的内部备份与临时回滚

这会导致：

- 持久态和预览态被混用
- 渲染态和模型态相互污染
- `commit/cancel` 需要靠回滚模型恢复一致性

### 5.2 目标状态模型

建议将状态明确划分为三层：

#### A. Persisted State

真正保存到项目中的状态：

- `item.config`
- `item.filterEffect`
- `item.transitionOut`
- `item.animation`

#### B. Resolved Runtime State

按当前帧从持久态推导出的正式渲染态：

- `item.runtime.renderConfig`
- `item.runtime.renderFilterEffect`

#### C. Transient Interaction State

交互期间的临时覆盖态：

- `item.runtime.deferredRenderConfigPatch`
- `item.runtime.deferredRenderFilterEffect`
- `item.runtime.deferredAnimationPatches`

建议在 `UnifiedTimelineItemRuntime` 中新增：

```ts
export interface UnifiedTimelineItemRuntime<T extends MediaType = MediaType> {
  bunnyClip?: Raw<BunnyClip>
  textBitmap?: ImageBitmap
  textBitmapVersion?: number
  renderConfig?: GetConfigs<T>
  renderFilterEffect?: ClipFilterConfig
  deferredRenderConfigPatch?: Partial<GetConfigs<T>>
  deferredRenderFilterEffect?: ClipFilterConfig
  deferredAnimationPatches?: Partial<Record<AnimationGroupId, Record<string, number>>>
  transition?: ClipTransitionRuntime
  isInitialized: boolean
}
```

## 6. 渲染链路调整方案

### 6.1 现状

当前渲染查询：

- `TimelineItemQueries.getRenderConfig(item)` 返回 `item.runtime.renderConfig || item.config`
- `TimelineItemQueries.getRenderFilterEffect(item)` 返回 `item.runtime.renderFilterEffect || item.filterEffect`

问题在于：

- 这些字段没有正式表达 `defer` 临时态
- `defer` 预览通过改模型实现，渲染链路只是“顺便工作”

### 6.2 目标

渲染链路应显式读取最终渲染态：

`final render state = persisted state + resolved runtime state + transient interaction overlay`

建议新增：

- `resolveRenderConfigAtFrame`
- `resolveRenderFilterEffectAtFrame`
- `resolveFinalRenderState`

其中 `resolveFinalRenderState` 的伪代码如下：

```ts
function resolveFinalRenderState(item, frame) {
  const baseConfig = resolveRenderConfigAtFrame(item, frame)
  const baseFilter = resolveRenderFilterEffectAtFrame(item, frame)

  const finalConfig = {
    ...baseConfig,
    ...(item.runtime.deferredRenderConfigPatch ?? {}),
  }

  const finalFilter =
    item.runtime.deferredRenderFilterEffect
    ?? baseFilter

  return {
    config: finalConfig,
    filterEffect: finalFilter,
  }
}
```

然后让以下模块统一读最终渲染态：

- Preview selection overlay
- Mask overlay
- WebGL chain builder
- 导出渲染器

### 6.3 是否需要改 WebGL 渲染器

不建议大改 WebGL renderer 本体。

建议只改它的状态读取入口，让它继续通过统一查询方法获取渲染态。  
重构重点应放在：

- `queries.ts`
- `animationInterpolation.ts`
- `render-state/`

而不是 shader 或 draw call。

## 7. 属性修改协议

### 7.1 新的统一 API

建议统一对外暴露：

```ts
setClipProperty(intent: PropertyChangeIntent): Promise<void>
setClipProperties(intents: PropertyChangeIntent[]): Promise<void>
beginClipPropertyInteraction(context): InteractionHandle
```

其中：

- UI 的直接提交使用 `setClipProperty`
- 拖动中的 defer 使用 `beginClipPropertyInteraction`
- AI 批量改动使用 `setClipProperties`

### 7.2 ChangePlan 结构

建议 `ChangePlan` 的 operation 粒度统一：

```ts
export type ChangeOperation =
  | {
      kind: 'config-patch'
      timelineItemId: string
      patch: Record<string, unknown>
    }
  | {
      kind: 'filter-effect-replace'
      timelineItemId: string
      value?: ClipFilterConfig
    }
  | {
      kind: 'transition-out-replace'
      timelineItemId: string
      value?: ClipTransitionOutConfig
    }
  | {
      kind: 'animation-group-patch'
      timelineItemId: string
      frame: number
      groupId: AnimationGroupId
      patch: Record<string, number>
    }
  | {
      kind: 'text-rebuild'
      timelineItemId: string
      text?: string
      stylePatch?: Record<string, unknown>
    }
```

这样做的好处：

- writer 行为明确
- undo/redo 边界统一
- 便于 AI、批处理、宏命令复用

## 8. 对现有模块的替换策略

### 8.1 `useHistoryOperations`

当前职责过重，应拆分。

保留职责：

- 作为 `unifiedStore` 的对外 facade
- 将 UI 请求转发给 mutation / transaction 层

剥离职责：

- 属性语义分流
- 关键帧策略判断
- 文本重建策略判断

重构后它应接近：

```ts
async function updatePropertyWithHistory(...) {
  const plan = propertyMutationService.plan(...)
  await historyTransactionService.execute(plan)
}
```

### 8.2 现有命令类

现有属性相关命令不再保留兼容职责。

替换策略：

- 新系统完成同等能力后，直接删除旧属性命令
- 所有属性修改统一走 `ApplyChangePlanCommand`
- 不再继续维护专用 `Update*Command`

优先删除对象：

- `UpdateVisualTransformCommand`
- `UpdateAudioPropertiesCommand`
- `UpdateTextCommand`
- `UpdateMaskCommand`
- `UpdatePropertyCommand`
- `SetAnimationGroupValueCommand`

### 8.3 `AnimationSession`

当前实现通过修改模型 + restore 回滚，不适合作为重构后的基础设施。

建议改造为：

- 不再保存 `originalConfig/originalAnimation` 用于整体 restore
- 只保存 `pending transient patches`
- 将 patch 写入 runtime transient overlay
- commit 时转成 `ChangePlan`
- cancel 时直接清空 overlay

### 8.4 `TimelineItemQueries`

建议角色收窄为纯查询层。

保留：

- 类型守卫
- 状态查询
- 渲染态读取

移除趋势：

- 隐式承担属性策略判断

## 9. 迁移阶段规划

建议按 5 个阶段推进，但真正开始实施时，不应先铺完整通用骨架，而应先做一个可运行的最小切片。  
本方案建议以 `transform.x` 作为首个试点属性，用它验证统一属性入口、变更计划、history 执行、渲染读取这条主链路。

### 阶段 0：冻结扩散

目标：

- 先从属性区所有用户操作入口封口，避免用户继续通过组件走散乱的属性修改路径
- 属性区中的所有属性编辑行为必须统一收敛到指定提交入口，而不是各自决定调用路径
- 暂不处理 Agent、脚本化调用、内部构造辅助流程中的遗留直写路径

动作：

- code review 规则明确：属性区所有用户可达 UI / composable 不得各自实现属性提交分流
- 现有属性面板、属性工具栏、属性交互控件中的提交行为统一收敛到 store / history 入口
- 即使底层暂时仍复用旧 command 或旧写入实现，属性区入口层也必须先完成统一封口
- Agent 路径本阶段暂不纳入治理范围，后续在统一 mutation 入口落地时再收敛
- 新功能必须接入统一重构方向，至少不能新增属性区内新的分散入口

阶段边界说明：

- 本阶段目标是“拦住用户通过属性区组件继续扩散旧入口”，不是一次性建立系统级唯一写入口
- 阶段 0 优先解决的是“入口分散”问题，不要求同阶段内把所有底层实现立即替换为新架构
- 因此，本阶段完成后仍可能保留非 UI 路径的直接写 `config` 逻辑
- 这类遗留路径不视为阶段 0 阻塞项，但属性区 UI 不得再直接触达这些分散路径

### 阶段 1：`transform.x` 最小试点

目标：

- 不追求一次建立完整通用骨架
- 只打通 `transform.x` 的最小闭环
- 用真实属性验证新骨架的抽象是否成立

范围约束：

- 只支持 `transform.x`
- 只支持 direct commit
- 只支持属性面板中的 number input
- 不处理 defer / slider dragging / preview overlay
- 不处理 `transform.y`、`size`、`rotation`、`opacity`
- 不处理 `audio`、`filter`、`mask`、`text`
- 不做完整批量属性接口

核心目标链路：

`属性面板 X 输入 -> 统一属性入口 -> PropertyMutationService -> ChangePlan -> ApplyChangePlanCommand -> 渲染读取`

建议产物：

- 最小 `ClipPropertyPath` 定义，首版只包含 `transform.x`
- 最小 `PropertyChangeIntent`
- 最小 `ChangePlan`
- 最小 `ChangeOperation`
- `transform.x` 的首个 property schema
- 只支持本试点的 `PropertyMutationService.plan(...)`
- 只支持本试点 operation 的 `ApplyChangePlanCommand`

完成标准：

- 修改 `X` 数字输入可以正确生效
- 在存在和不存在关键帧的情况下行为正确
- undo / redo 正常
- 属性区入口不再自己决定写 `config` 还是 `animation`
- 这条链路可以作为后续 `transform.y` 的复制模板

阶段边界说明：

- 本阶段的重点是验证“通用骨架最小切片是否成立”，不是追求一次性抽象完所有属性
- 骨架的接口命名应保持通用，但实现范围必须刻意绑定到一个真实属性
- 如果 `transform.x` 无法顺利跑通，说明骨架抽象本身仍不成立，不应继续横向扩展

### 阶段 2：建立可扩展骨架

目标：

- 将阶段 1 证明可行的实现抽象为可扩展骨架
- 扩展 schema / mutation / history transaction / render-state 的通用能力
- 为后续属性迁移建立稳定模板

产物：

- `property-schema/registry.ts`
- `property-mutation/PropertyMutationService.ts`
- `history/ApplyChangePlanCommand.ts`
- `render-state/RenderStateResolver.ts`
- runtime 新增 deferred 字段
- 对 `transform.y` / `transform.size` 等相邻属性的可复制支持模式

这一阶段的完成标准不是“抽象看起来完整”，而是“可以低风险复制到第二个、第三个属性”。

### 阶段 3：渲染态与 defer 脱钩持久模型

目标：

- 让 defer 不再直接改持久模型

优先迁移对象：

- transform defer
- filter defer
- mask defer

完成标准：

- `AnimationSession.apply()` 不再写 `item.animation`
- `setTimelineItemFilterEffectForCmd()` 不再被用作 defer 预览通道
- 所有 defer 渲染统一改为基于 transient overlay

### 阶段 4：迁移属性提交入口

目标：

- 将属性提交整段切换到 `PropertyMutationService`

优先迁移对象：

- `audio.isMuted`
- `audio.volume`
- `transform.*`
- `filter.intensity`
- `mask.*`
- `text.content`
- `text.style.*`

完成标准：

- `useHistoryOperations` 不再做属性分流
- 旧属性更新入口被替换或删除

### 阶段 5：收缩命令体系与清理旧入口

目标：

- 用通用 transaction command 完整替换属性专用命令
- 删除剩余旧属性系统代码
- 删除直接修改 `config` 的旧逻辑
- 删除旧 defer 回滚逻辑
- 删除旧 history 分流逻辑

完成标准：

- 全仓库不存在 UI/composable 对 `item.config.xxx = ...` 的直接写入
- 属性系统的单一入口正式建立
- 旧属性实现已从主路径移除

## 10. 第一阶段落地范围

建议第一阶段只做 `transform.x` 的真实试点，不做完整基础设施铺设。

### 10.1 建议实际提交内容

1. 在文档中明确 `Phase 1: transform.x pilot` 的范围和边界
2. 新建最小 `property-schema/`，首版只注册 `transform.x`
3. 新建最小 `property-mutation/PropertyMutationService.ts`
4. 新建最小 `history/ApplyChangePlanCommand.ts`
5. 从属性区 `transform.x` 的 number input 接入统一属性入口
6. 保持现有渲染读取路径可工作，不强制本阶段引入完整 `RenderStateResolver`

### 10.2 第一阶段不要做的事

- 不要先把所有 schema 字段设计完整
- 不要先把 `storage kind` / `deferred mode` / `batch intents` 一次定义到位
- 不要马上删除所有旧命令
- 不要一次性替换所有属性面板
- 不要同时改 defer、slider、preview drag
- 不要同时改 timeline 结构命令
- 不要在第一阶段重写导出器

## 11. 风险与控制

### 11.1 最大风险

最大风险不是类型错误，而是：

- 某些交互路径依赖当前“污染模型即可预览”的副作用
- 迁移后预览与 commit 行为不一致

### 11.2 控制策略

建议对以下场景建立回归测试：

- `transform.x` 在无关键帧情况下的直接修改
- `transform.x` 在有关键帧情况下的直接修改
- `transform.x` 在播放头不允许编辑时的禁止修改
- `transform.x` 的 undo / redo

在阶段 3 之前，不要求把 defer 相关场景纳入本轮最小试点回归范围。

### 11.3 验证方式

至少需要三层验证：

- 单元测试：schema、mutation planning、render resolving
- 集成测试：history + interaction session
- 手工回归：preview、timeline、export 基本路径

## 12. 建议的实施顺序

推荐按下面顺序推进：

1. 先做 `transform.x` 的最小试点。
2. 再把试点沉淀为可扩展骨架。
3. 再迁移 defer。
4. 再迁移其他属性提交路径。
5. 最后收缩命令和删除旧逻辑。

原因：

- 如果一开始就铺完整骨架，很容易做成脱离真实属性的抽象设计
- `transform.x` 是最小真题，能最早暴露 schema、mutation、history 边界是否合理
- `defer` 是复杂路径，应放在最小提交链路验证通过之后处理

## 13. 最终目标架构图

```text
UI / Composables
    ->
Property Intent API
    ->
PropertyMutationService
    -> (direct commit)
ChangePlan
    ->
HistoryTransactionService
    ->
Persisted Writers
    ->
UnifiedTimelineItemData

UI / Composables
    ->
InteractionSession
    ->
Transient Overlay Runtime State
    ->
RenderStateResolver
    ->
Preview / WebGL / Export Render Read Model
```

## 14. 结论

这次重构的关键不是“重写几个命令”，而是把片段属性系统从“隐式共享状态驱动”改成“显式状态分层驱动”。

正式目标应定义为：

`持久状态、渲染状态、交互状态彻底分离；属性语义集中定义；属性修改和预览各走单一协议。`

如果按本方案推进，最终会得到：

- 清晰的属性分层
- 更稳定的 defer 交互
- 更可控的 undo/redo
- 更容易扩展的新属性接入方式
- 更低的渲染副作用风险
