# LightCut Frontend 动态属性 Schema 长期设计方案

## 1. 文档目的

这份文档用于定义片段属性系统中的动态属性 schema 长期方向。

当前只有 `filter` 域需要使用动态 schema：不同 filter package 可能暴露不同参数，不能完全依赖静态属性表。但这个设计不应该做成 filter 专属能力，否则后续 `transition`、`text`、`mask` 或其他插件化能力出现动态参数时，又会重复设计一套类似机制。

本方案的目标是回答：

- 动态属性 schema 应该解决什么问题
- 哪些部分可以动态声明
- 哪些执行协议必须保持稳定
- 当前 filter 参数应该如何作为第一批使用场景
- 后续其他域如何复用同一套 schema resolver / provider 机制

一句话概括：

**用静态稳定的 property engine，承接由不同属性域动态声明的 property schemas；当前第一批动态声明来源是 filter package metadata。**

## 2. 背景与问题

现有单属性试点方案已经把稳定路径从 `transform.rotation` 复制到了 `transform` 与 `audio.volume` 等静态属性。

这些属性有一个共同点：

- property id 固定
- value fields 固定
- animation group 固定
- UI 控件固定
- normalize / clamp 规则固定

但有些属性域天然不是固定集合。例如 filter：

```ts
interface ClipFilterConfig {
  effectPackageId: string
  templateId: string
  packageVersion: string
  catalogVersion: string
  intensity: number
  params: Record<string, unknown>
  packagePayload: FilterPackagePayload
}
```

其中 `intensity` 是静态通用属性，而 `params` 来自具体 filter package 的 `parameterSchema`。

这意味着 filter 域天然有两种属性来源：

1. 静态属性，例如 `filter.intensity`
2. 动态属性，例如 `filter.param.exposure`、`filter.param.radius`、`filter.param.center`

如果只迁移静态属性，长期无法覆盖 package 参数。

如果把整个 `params` 或 `filterEffect` 当成一个黑盒属性迁移，又会破坏 property system 的粒度，导致 normalize、keyframe、overlay、UI 控件和 undo / redo 都无法稳定复用。

因此，需要一套通用动态 schema 机制：属性集合可以按当前 item / 当前 package / 当前上下文动态生成，但生成后的 schema 必须进入同一套 property engine。

## 3. 设计原则

### 3.1 属性集合可以动态，执行协议必须稳定

动态 provider 可以声明“当前上下文有哪些属性”，但不能动态发明提交、历史、预览和关键帧策略。

允许动态的内容：

- property key / parameter key
- value type
- 默认值
- min / max / step
- label / group / unit 等展示 metadata
- 是否建议支持 animation
- 当前 item 是否支持该属性

必须稳定的内容：

- property id 命名规则
- schema 解析流程
- direct commit 策略
- keyframe toggle 策略
- transient overlay 策略
- ChangePlan operation 类型
- undo / redo 边界
- render-state 读取规则

### 3.2 不迁移动态参数集合黑盒

不要把动态参数建成一个整体属性：

```text
filter.params
plugin.params
text.dynamicStyle
```

而应该建成独立属性：

```text
filter.param.exposure
filter.param.temperature
filter.param.radius
filter.param.center
```

这样每个参数都有独立的能力声明、normalize 规则、keyframe 语义和 UI 控件。

### 3.3 当前只有 filter 使用动态 schema

这套机制要通用，但落地不能一下扩散到多个域。

当前实施范围：

- 静态 filter 属性：`filter.intensity`
- 动态 filter 参数：`filter.param.<key>`

暂不把 `transition`、`text`、`mask` 接入动态 schema，除非它们后续出现明确的动态参数来源和真实 UI 入口。

## 4. 属性来源分层

动态 schema 长期应分为三类来源。

### 4.1 静态属性

这些属性由代码固定声明：

```text
transform.rotation
transform.position
transform.size
transform.opacity
audio.volume
filter.intensity
```

它们适合使用静态 schema provider。

### 4.2 动态参数属性

这些属性由某个 domain 的 metadata 动态声明。

当前唯一来源是 filter package：

```text
filter.param.<key>
```

示例：

```text
filter.param.exposure
filter.param.contrast
filter.param.blurRadius
filter.param.center
filter.param.enabled
```

未来如果其他域也出现类似 metadata，可以复用同一机制：

```text
transition.param.<key>
text.styleParam.<key>
```

这些未来路径只是预留方向，不是当前实施范围。

### 4.3 实例身份 / 资源绑定

这类字段描述“当前 item 使用哪个资源或 package”，不适合直接进入 animatable property schema。

以 filter 为例：

- `effectPackageId`
- `templateId`
- `packageVersion`
- `catalogVersion`
- `packagePayload`

apply / remove filter 应作为 filter 实例操作处理，而不是作为 `filter.param.*` 属性迁移的一部分。

## 5. Property Id 命名规则

动态属性推荐命名：

```text
<domain>.param.<parameterKey>
```

当前 filter 实际使用：

```text
filter.intensity
filter.param.<parameterKey>
```

不推荐：

```text
filter.params.<parameterKey>
filter.<packageId>.<parameterKey>
```

原因：

- `domain.param.*` 清楚表达这是某个 domain 的动态参数属性
- property id 不绑定具体 packageId，避免切换 package 后路径规则变化
- 当前 item 是否支持某个参数由 schema resolver 判断
- package-specific 差异保留在 schema resolution 阶段，而不是塞进 property id

### 5.1 参数 key 约束

`filter.param.<parameterKey>` 依赖 property id 可稳定解析，因此 `parameterKey` 不能完全信任 package manifest 的自由字符串。

第一版建议约束 filter package manifest 中的参数 key：

```text
^[A-Za-z_][A-Za-z0-9_]*$
```

规则：

- 不允许空字符串
- 不允许 `.`，避免破坏 `filter.param.<key>` 分段解析
- 不允许使用 `intensity`、`params`、`packagePayload` 等 filter 保留字段作为参数 key
- 不符合规则的 package 应在 manifest load / validate 阶段报错，而不是在 property resolver 阶段静默跳过

如果未来确实需要支持更自由的参数 key，应先定义统一 escape / unescape 规则，再进入 property id。

## 6. Core Property Schema

长期应形成一个稳定的 core schema contract，静态属性和动态属性都转换成这类 schema 后再交给 planner。

示意接口：

```ts
type PropertyDomain = 'transform' | 'audio' | 'filter' | 'mask' | 'text' | 'transition'
type PropertyValueKind = 'number' | 'boolean' | 'color' | 'vec2'
type PropertyTarget = 'config' | 'filterEffect' | 'textStyle' | 'transition'

interface PropertySchemaContext {
  item: UnifiedTimelineItemData
  frame?: number
  locale?: string
}

interface PropertyWriteContext extends PropertySchemaContext {
  previousValue?: unknown
}

interface PropertySchema<TValue = unknown> {
  propertyId: string
  domain: PropertyDomain
  valueKind: PropertyValueKind
  target: PropertyTarget
  animationGroupId?: string
  valueFields?: readonly string[]
  supportsDirectCommit: boolean
  supportsKeyframeToggle: boolean
  supportsTransientOverlay: boolean
  normalize?: (value: TValue, context: PropertyWriteContext) => TValue
  equals?: (a: TValue, b: TValue) => boolean
}
```

这里的重点不是一次做完整通用类型，而是明确长期边界：

- planner 消费 `PropertySchema`
- schema 可以来自静态 provider，也可以由动态 provider 生成
- schema 需要显式声明属性最终写入哪个宿主 target，而不是默认把 static patch 写进 `item.config`
- execution 仍由统一 ChangePlan / command 层负责
- domain-specific 差异通过 schema 和 operation 表达，而不是分散到 UI / composable 中

补充说明：

- 当前代码已经在静态 schema 上验证了 `target` 这层抽象：`transform.*` / `audio.volume` 写 `config`，`filter.intensity` 写 `filterEffect`
- 这层 target 信息已经进入 `PropertyPlanner -> ChangePlan -> ApplyChangePlanCommand` 链路
- 因此后续动态参数设计应优先考虑“能否通过 schema target + patch 形态表达”，而不是先为某个 domain 设计专用 command

## 7. Schema Resolver / Provider

不要只依赖全局静态 registry。动态属性需要按当前 item 解析。

推荐引入 resolver：

```ts
interface PropertySchemaResolver {
  getSchema(context: PropertySchemaContext, propertyId: string): PropertySchema | null
  listSchemas(context: PropertySchemaContext): PropertySchema[]
}
```

resolver 由多个 provider 组成：

- static transform provider
- static audio provider
- static filter provider，用于 `filter.intensity`
- dynamic filter parameter provider，用于 `filter.param.*`
- 后续其他 domain provider

provider 示意：

```ts
interface PropertySchemaProvider {
  getSchema(context: PropertySchemaContext, propertyId: string): PropertySchema | null
  listSchemas(context: PropertySchemaContext): PropertySchema[]
}
```

当前 dynamic filter parameter provider 的职责：

1. 检查 item 是否支持 filter
2. 检查 item 是否存在 `filterEffect`
3. 读取 `filterEffect.packagePayload.parameterSchema`
4. 为每个 parameter 生成 `filter.param.<key>` schema
5. 根据 parameter type 决定能力开关

当前状态补充：

- resolver / provider 已经落地到 `src/core/property-system/schema/resolver.ts`
- 当前 resolver 已由静态属性 provider 与 dynamic filter parameter provider 组成
- `PropertyPlanner` 已通过 resolver 按当前 item / frame 解析 schema
- `filter.param.*` 已作为第一条动态 schema 路径接入 direct commit、deferred overlay、keyframe 和属性面板渲染
- 下一阶段重点是收紧 schema contract、property id 工具和 UI view model，而不是新增其他 domain provider

## 8. Dynamic Parameter Metadata

动态属性 provider 需要从 domain metadata 生成 property schema。

当前 filter 已有参数定义基础：

```ts
type EffectPackageParameterType = 'number' | 'boolean' | 'color' | 'vec2'

interface EffectPackageParameterDefinition {
  type: EffectPackageParameterType
  default?: unknown
  min?: number
  max?: number
  step?: number
}
```

长期可以抽象成通用参数定义：

```ts
interface DynamicPropertyParameterDefinition {
  type: 'number' | 'boolean' | 'color' | 'vec2'
  default?: unknown
  min?: number
  max?: number
  step?: number
  label?: LocalizedText
  group?: string
  animatable?: boolean
  ui?: 'slider' | 'number' | 'toggle' | 'color' | 'vec2'
  unit?: 'percent' | 'degree' | 'px'
}
```

字段用途：

- `label`：属性面板展示名称
- `group`：属性面板分组
- `animatable`：声明是否建议支持关键帧
- `ui`：避免 UI 完全靠 type 猜控件
- `unit`：用于展示和输入归一化

这些字段不要求第一版全部实现，但 schema 设计应预留方向。

## 9. 参数类型能力矩阵

动态参数不应该默认全部支持所有能力。

建议第一版能力矩阵：

| 参数类型 | direct commit | transient overlay | keyframe | 说明 |
| --- | --- | --- | --- | --- |
| `number` | 支持 | 支持 | 可支持 | 第一批动态参数迁移目标 |
| `vec2` | 支持 | 支持 | 可支持 | 作为组属性迁移，不能拆成单独 x / y |
| `boolean` | 支持 | 不建议 | 默认不支持 | 适合 direct only |
| `color` | 支持 | 可评估 | 暂缓 | 需要稳定颜色插值规则 |

其中 `number` 是最适合继 `filter.intensity` 之后迁移的动态参数类型。

## 10. Animation Group 设计

动态参数不应共用一个黑盒 animation group。

不推荐：

```text
filter.params
```

推荐：

```text
filter.param.exposure
filter.param.blurRadius
filter.param.center
```

规则：

- `number` 参数：一参数一组
- `vec2` 参数：一参数一组，value fields 为完整组字段
- `boolean` 参数：默认 direct only，不创建 animation group
- `color` 参数：先 direct only，等颜色插值模型明确后再开放 keyframe

对于 `vec2`，应保持组级迁移：

```ts
{
  propertyId: 'filter.param.center',
  animationGroupId: 'filter.param.center',
  valueFields: ['x', 'y']
}
```

不要拆成 `filter.param.center.x` 与 `filter.param.center.y` 两条独立 animation group，除非未来动画模型明确支持子字段组语义。

### 10.1 动态 group 类型策略

当前代码中的 `AnimationGroupId` / `AnimationGroupValueMap` 是静态 union，适合 `transform.rotation`、`audio.volume`、`filter.intensity` 这类固定属性；但 `filter.param.<key>` 来自 package metadata，不能要求每个参数 key 都提前写进静态 union。

因此动态参数接入时需要把 animation group 分成两类：

```ts
type StaticAnimationGroupId = AnimationGroupId
type DynamicAnimationGroupId = `filter.param.${string}`
type PropertyAnimationGroupId = StaticAnimationGroupId | DynamicAnimationGroupId
```

动态 group 的 value 不能继续依赖静态 `AnimationGroupValueMap[G]` 推导，而应使用 schema 决定值形态：

```ts
type DynamicAnimationGroupValue =
  | { value: number }
  | { value: boolean }
  | { value: string }
  | { x: number; y: number }
```

第一版建议只开放：

- `filter.param.<key>` + `number`：keyframe value 使用 `{ value: number }`
- `filter.param.<key>` + `vec2`：keyframe value 使用 `{ x: number; y: number }`

执行规则：

- 静态 group 继续走现有 `AnimationGroupValueMap`
- 动态 group 由 `PropertySchema.valueKind` / `valueFields` 负责 normalize、equals、interpolate 和 apply
- `getCurrentGroupValue()`、`findKeyframeAtFrame()`、`ensureTrack()` 等 animation engine API 已接受 `PropertyAnimationGroupId`
- 当前 `filter.param.*` 的 `number` / `vec2` 已开放 keyframe，`boolean` 保持 direct only

这样可以避免为了每个 package 参数改全局静态类型，也避免把动态参数退化成一个 `filter.params` 黑盒 group。

## 11. ChangePlan Operation

长期目标是尽量复用现有 operation 形态：

- `no-animation-group-patch`
- `animation-keyframe-update`
- `animation-keyframe-create`
- `animation-keyframe-delete`

第一优先级不是为新 domain 发明新 operation，而是先判断现有 operation 是否已经足够表达：

- `no-animation-group-patch`
- `animation-keyframe-update`
- `animation-keyframe-create`
- `animation-keyframe-delete`
- schema `target`
- schema `valueFields`
- schema `normalize`

当前 `filter.intensity` 的落地已经证明：

- `no-animation-group-patch` 不必默认等于“写入 `item.config`”
- 只要 operation 携带 schema target，command 就可以把 patch 应用到正确宿主
- `filterEffect` 不需要为了 `intensity` 单独新增 `filter-effect-patch`

因此长期策略应改为：

1. 默认优先复用通用 operation
2. 由 schema 提供宿主 target 与值形态信息
3. command 按 target 执行 patch
4. 只有当某类属性无法被“通用 operation + schema target”表达时，才引入新的 domain-level operation

对于未来的 `filter.param.*`，可以预留小范围专用 operation，但它应该是兜底方案，不是起点。示意如下：

```ts
interface FilterParamPatchOperation {
  kind: 'filter-param-patch'
  timelineItemId: string
  frame: number
  key: string
  value: unknown
}
```

只有当 `params[key]` 的 patch 形态无法稳定落入通用 `patch + target` 模型时，才考虑这种 operation。它的职责也应严格限制为 patch：

```ts
const nextFilterEffect = normalizeClipFilterConfig({
  ...item.filterEffect,
  params: {
    ...item.filterEffect.params,
    [key]: value,
  },
})

item.filterEffect = nextFilterEffect
item.runtime.renderFilterEffect = nextFilterEffect // 仅作为当前合成结果缓存
```

它不应该携带 package-specific 执行逻辑。

写入规则：

- `filter.intensity` 优先继续复用通用 operation + `target: 'filterEffect'`
- `filter-param-patch` 如果存在，也只 patch `filterEffect.params[key]`
- `animation-keyframe-*` 在动态 group 开放后仍用于关键帧本身，最终值写回由 animation registry / schema writer 负责
- `no-animation-group-patch` 不应再被文档定义为“只写 `item.config` 的 fallback”
- 它的真实语义应是“无关键帧时，对 schema target 执行 static patch”

未来如果其他 domain 需要类似能力，应新增 domain-level patch operation，而不是为每个动态参数新增 command。

## 12. Render-State / Overlay

动态参数的 preview 不应通过污染持久模型实现。

当前 filter 已有一条已落地的静态样板：

- `filter.intensity` 使用独立 overlay 进行 preview
- `slider-input` 只写 overlay
- `slider-change` 再提交 ChangePlan
- render 查询统一合成 base / animated / overlay

这说明 filter overlay 不应一开始就只围绕 `params` 黑盒建模。

对 filter 来说，长期至少会有两类 overlay：

1. 静态通用字段 overlay，例如 `filter.intensity`
2. 动态参数 overlay，例如 `filter.param.<key>`

动态参数部分可以先用下面这类结构表达：

```ts
interface FilterParamOverlayEntry {
  timelineItemId: string
  frame: number
  params: Record<string, unknown>
}
```

读取顺序：

1. 持久态 `item.filterEffect`
2. 当前 frame 的 animation resolved filter params
3. transient overlay params

最终渲染读到的是合成后的 render filter effect。

这样 `slider-input` 只写 overlay，`slider-change` 再提交 ChangePlan，和 `transform.rotation` / `transform.opacity` / `audio.volume` 的样板保持一致。

### 12.1 filter overlay 合成路径

filter 的 render-state 应显式区分三层数据：

```ts
interface FilterRenderState {
  base?: ClipFilterConfig
  resolved?: ClipFilterConfig
  overlay?: {
    intensity?: number
    params?: Record<string, unknown>
  }
}
```

合成规则：

```ts
function resolveRenderFilterEffect(item, frame): ClipFilterConfig | undefined {
  const base = item.filterEffect
  if (!base) return undefined

  const animated = resolveFilterAnimation(item, frame, base)
  const intensityOverlay = getFilterIntensityOverlay(item.id)
  const paramOverlay = getFilterParamOverlay(item.id, frame)

  return normalizeClipFilterConfig({
    ...animated,
    ...(intensityOverlay !== undefined ? { intensity: intensityOverlay } : null),
    params: {
      ...animated.params,
      ...paramOverlay?.params,
    },
  })
}
```

交互流程：

1. `slider-input` / pointer move 只写对应属性的 overlay
2. 渲染读取 `resolveRenderFilterEffect()` 的合成结果
3. `slider-change` 清理 overlay，并提交 `ChangePlan`
4. `ApplyChangePlanCommand` 写入持久 `filterEffect` 或关键帧
5. 提交后再次通过同一条 render-state 合成路径读取，确保 commit 结果与 preview 一致

注意：

- overlay 不应直接写 `item.filterEffect`
- overlay 不应直接写 `item.runtime.renderFilterEffect` 作为唯一真实来源
- `item.runtime.renderFilterEffect` 如仍需保留，应只作为合成结果缓存，而不是交互层可随意修改的 draft
- filter apply / remove 操作必须清理对应 item 的 filter overlay，避免切换 package 后旧参数残留

通用原则：

- overlay 是 transient render-state
- overlay 不直接修改持久 `config` / `filterEffect` / `animation`
- commit 后结果必须与 overlay preview 一致

## 13. UI 生成策略

长期不要在 domain panel 中手写所有动态参数控件。

推荐流程：

1. `PropertySchemaResolver.listSchemas(item)` 返回当前 item 可编辑属性
2. UI 按 domain 过滤 schema
3. 固定渲染静态核心属性
4. 遍历动态参数 schemas
5. 根据 `valueKind` / `ui` / `min` / `max` / `step` 生成控件

filter 当前策略：

- 固定渲染 `filter.intensity`
- 遍历 `filter.param.*`

控件建议：

- `number`：slider + number input
- `boolean`：toggle
- `color`：color picker
- `vec2`：dual number field

UI 只消费 property schema 或 view model，不直接解析原始 package metadata。

## 14. 分阶段落地建议

### 阶段 A：迁移 `filter.intensity`

目标：

- 静态 schema 接入 `filter.intensity`
- direct commit 走 `PropertyPlanner`
- slider preview 走 transient overlay
- keyframe toggle 走 `ChangePlan`
- 旧 filter deferred 污染路径停止作为主路径

当前状态：

- 这一阶段已经完成，并已作为第一条 filter 域稳定样板落地
- 同时验证了 schema `target` 需要进入 planner / command，而不是默认写入 `item.config`

完成后，filter 域具备第一条稳定样板。

### 阶段 B：引入 schema resolver

目标：

- 把静态 schema 获取从硬编码 `getSchema()` 逐步迁到 resolver
- 保持已有 transform / audio 行为不变
- 为 dynamic provider 留出入口

这一阶段不需要立即开放所有动态参数。

### 阶段 C：开放 `number` 类型 `filter.param.*`

目标：

- 从 `filterEffect.packagePayload.parameterSchema` 生成 `filter.param.<key>` schema
- 支持 direct commit
- 支持 transient overlay
- 对 `animatable !== false` 的 number 参数支持 keyframe

这一步应选择一个真实 filter package 的真实 number 参数作为样板，而不是只写 mock schema。

### 阶段 D：开放 `vec2` 类型 `filter.param.*`

目标：

- 以组属性方式迁移
- value fields 保持完整组语义
- direct intent 可以 patch 单字段，但 animation keyframe 写入完整组值

### 阶段 E：评估 `boolean` 与 `color`

目标：

- `boolean` 默认 direct only
- `color` 先 direct only
- 只有在插值、overlay、UI、渲染都稳定后，再考虑关键帧

### 阶段 F：评估其他 domain 的动态 schema

只有当其他 domain 同时满足以下条件时，才接入动态 schema：

- 有真实 metadata 来源
- 有用户可达 UI 入口
- 有明确 storage / render-state 读取规则
- 能复用现有 ChangePlan / command 协议

## 15. 非目标

第一版动态 schema 不处理：

- 动态发明新的 command 类型
- package-specific mutation hook
- 每个 package 自定义 preview session
- 一次迁移所有参数类型
- 把整个动态参数集合当作一个 animatable property
- 把动态参数集合作为黑盒整体关键帧
- 同时接入多个动态 domain

## 16. 决策准则

后续实现中，遇到是否扩展动态参数能力时，用下面几条判断：

1. 当前 domain 的静态样板属性是否已经完整跑通 direct / overlay / keyframe / undo / redo
2. 新参数是否能用现有 ChangePlan / command 协议表达
3. 新参数是否有明确 value type、normalize 规则和默认值
4. 新参数是否真的需要 keyframe，而不是只需要 direct commit
5. schema 是否只是声明属性，而不是把 package-specific 执行逻辑塞进 property system
6. 是否有真实 UI 入口和真实 package metadata，而不是为了抽象完整度提前实现

只要这些问题答不清楚，就应该继续保留为 direct only，或者暂缓迁移。

## 17. 当前推荐结论

动态 schema 机制应按通用能力设计，但当前只由 filter 使用。

推荐顺序：

1. 已完成：`filter.intensity`
2. `PropertySchemaResolver`
3. 第一批 `number` 类型 `filter.param.*`
4. `vec2` 类型 `filter.param.*`
5. direct-only 的 `boolean` / `color`
6. 再评估 `color` keyframe 与更复杂参数类型
7. 最后才评估其他 domain 的动态 schema 接入

最终目标不是让 package 控制 property system，而是让 package 只声明参数能力；property system 负责稳定地处理提交、预览、历史和关键帧。
