# Timeline Item Render Schema v2 Plan

## 背景

当前 `UnifiedTimelineItemData.config` 是一个按媒体类型合并后的扁平配置：

```ts
video: VisualProps & AudioProps
image: VisualProps
audio: AudioProps
text: VisualProps & TextProps
```

这个结构的优点是访问简单，但长期语义不清：

- `VisualProps` 里混入了 `mask`，导致基础几何属性和扩展视觉效果混在一起。
- `transitionOut`、`filterEffect` 是顶层字段，和 `mask` 的归属不一致。
- `config` 同时承载 transform、audio、text、mask，agent、backend codec、属性面板和动画系统很难判断字段含义。

本方案的最终目标是完成 schema v2：拆掉旧 `config`，改成分组式基础渲染配置和统一扩展渲染配置。

实施方式不采用一次性大迁移，而是先引入 `exRenderConfig` 作为兼容增量层，再按 filter、transition、mask、base render 的顺序逐步收口。每一步都要能独立编译、独立验证、独立回滚。

## 目标结构

`UnifiedTimelineItemData` 改为：

```ts
export interface UnifiedTimelineItemData<T extends MediaType = MediaType> {
  readonly id: string
  mediaItemId: MediaItemIdType<T>
  trackId: string
  timelineStatus: TimelineItemStatus
  mediaType: T
  timeRange: UnifiedTimeRange

  baseRenderConfig: TimelineBaseRenderConfig<T>
  exRenderConfig?: TimelineExtraRenderConfig

  animation?: GetAnimation<T>
  runtime: UnifiedTimelineItemRuntime<T>

  isPlaceholder?: boolean
  task?: PlaceholderTaskState
  provenance?: TimelineItemProvenance
}
```

基础渲染配置使用严格媒体类型映射：

```ts
export interface VisualProps {
  x: number
  y: number
  width: number
  height: number
  rotation: number
  opacity: number
  blendMode: BlendMode
  proportionalScale: boolean
}

export interface AudioProps {
  volume: number
  isMuted: boolean
}

export interface TextProps {
  text: string
  style: TextStyleConfig
}

export type TimelineBaseRenderConfigMap = {
  video: {
    visual: VisualProps
    audio: AudioProps
  }
  image: {
    visual: VisualProps
  }
  audio: {
    audio: AudioProps
  }
  text: {
    visual: VisualProps
    text: TextProps
  }
}

export type TimelineBaseRenderConfig<T extends MediaType> = TimelineBaseRenderConfigMap[T]
```

扩展渲染配置统一放到 `exRenderConfig`：

```ts
export interface TimelineExtraRenderConfig {
  mask?: MaskConfig
  transition?: ClipTransitionOutConfig
  filter?: ClipFilterConfig
}
```

字段迁移规则：

| 旧字段 | 新字段 |
| --- | --- |
| `item.config.x` | `item.baseRenderConfig.visual.x` |
| `item.config.width` | `item.baseRenderConfig.visual.width` |
| `item.config.volume` | `item.baseRenderConfig.audio.volume` |
| `item.config.text` | `item.baseRenderConfig.text.text` |
| `item.config.style` | `item.baseRenderConfig.text.style` |
| `item.config.mask` | `item.exRenderConfig?.mask` |
| `item.transitionOut` | `item.exRenderConfig?.transition` |
| `item.filterEffect` | `item.exRenderConfig?.filter` |

最终态不保留旧字段读取兼容。迁移过程中允许短期兼容读和双写，但必须集中在 helper、command、codec 入口等少数边界层，不能散落到属性面板、渲染链和动画系统的业务代码里。

阶段性兼容读取规则：

| 目标字段 | 迁移期读取顺序 |
| --- | --- |
| `item.exRenderConfig?.filter` | `item.exRenderConfig?.filter ?? item.filterEffect` |
| `item.exRenderConfig?.transition` | `item.exRenderConfig?.transition ?? item.transitionOut` |
| `item.exRenderConfig?.mask` | `item.exRenderConfig?.mask ?? item.config.mask` |
| `item.baseRenderConfig` | 仅在 base render 迁移阶段引入，之前继续读取旧 `item.config` |

迁移期写入策略：

- filter/transition/mask 各自迁移期间可以短期双写新旧字段，保证已有调用点不立即断裂。
- 某一类字段的读路径全部收敛到 query/helper 后，再删除该类旧字段的写入。
- `baseRenderConfig` 放到最后迁移，不要在 filter/transition/mask 迁移时顺手拆 `config`。

## 动画和运行时配置

`GetAnimationMap` 这个映射本身可以保留：

```ts
type GetAnimationMap = {
  video: AnimationProps<'video'>
  image: AnimationProps<'image'>
  audio: AnimationProps<'audio'>
  text: AnimationProps<'text'>
}
```

需要改的是动画 group 的目标语义和 apply 路径。

当前动画系统默认把值写入扁平 `config`：

```ts
config.x
config.width
config.volume
config.mask
```
 
v2 以后，属性提交和动画插值需要拆成两条路径：

- 用户直接提交属性值、设置关键帧基准值时，写入持久配置。
- 播放/预览时按帧插值，只写入 `runtime`，不污染持久配置。

持久配置写入目标为：

```ts
baseRenderConfig.visual.x
baseRenderConfig.visual.width
baseRenderConfig.audio.volume
exRenderConfig.mask
exRenderConfig.filter
```

运行时动画插值输出目标为：

```ts
runtime.renderConfig.visual.x
runtime.renderConfig.visual.width
runtime.renderConfig.audio.volume
runtime.exRenderConfig.mask
runtime.exRenderConfig.filter
```

建议把属性 schema 的 target 改为：

```ts
export type AnimatablePropertyTarget =
  | 'visual'
  | 'audio'
  | 'mask'
  | 'filter'
```

`AnimationRegistry` 中的动画定义按目标拆分：

- transform position/size/rotation/opacity 写入 `baseRenderConfig.visual`
- audio volume 写入 `baseRenderConfig.audio`
- mask center/rotation/feather/intensity/size 写入 `exRenderConfig.mask`
- filter intensity 和动态 filter params 写入 `exRenderConfig.filter`

这里的“写入”指直接提交属性值或关键帧基准值。按帧 apply 动画时不能回写 `baseRenderConfig` 或 `exRenderConfig`，而是从持久配置派生运行时结果。

`runtime.renderConfig` 改为和 `baseRenderConfig` 同形状，承载 transform/audio/text 这类基础渲染配置的运行时结果；新增 `runtime.exRenderConfig`，和 `exRenderConfig` 同形状，承载 mask/filter 这类扩展效果的运行时结果：

```ts
export interface UnifiedTimelineItemRuntime<T extends MediaType = MediaType> {
  bunnyClip?: Raw<BunnyClip>
  textBitmap?: ImageBitmap
  textBitmapVersion?: number
  renderConfig?: TimelineBaseRenderConfig<T>
  exRenderConfig?: TimelineExtraRenderConfig
  transition?: ClipTransitionRuntime
  isInitialized: boolean
}
```

`runtime.renderFilterEffect` 移除。滤镜运行时值通过统一查询函数从 `runtime.exRenderConfig?.filter ?? exRenderConfig?.filter` 读取，再叠加 overlay；mask 同理从 `runtime.exRenderConfig?.mask ?? exRenderConfig?.mask` 读取。

## 查询和写入 API

为了避免业务代码直接写很多媒体类型判断，需要新增统一 helper。

推荐查询 API：

```ts
getBaseRenderConfig(item)
getRenderConfig(item)
getExtraRenderConfig(item)
getRenderMask(item)
getRenderFilter(item)
getRenderTransition(item)
```

推荐分组访问 API：

```ts
hasVisualRenderConfig(item)
hasAudioRenderConfig(item)
hasTextRenderConfig(item)
getVisualRenderConfig(item)
getAudioRenderConfig(item)
getTextRenderConfig(item)
```

推荐 patch API：

```ts
patchVisualRenderConfig(item, patch)
patchAudioRenderConfig(item, patch)
patchTextRenderConfig(item, patch)
patchExtraRenderConfig(item, patch)
```

业务代码迁移原则：

- 渲染链读取统一走 `TimelineItemQueries.getRenderConfig(item)` 和 `getRenderMask/getRenderFilter/getRenderTransition`。
- `getRenderConfig(item)` 返回的是分组结构。业务代码禁止再把它当成扁平对象读取，例如不要写 `getRenderConfig(item).rotation`、`getRenderConfig(item).volume`；必须先进入对应分组：`getRenderConfig(item).visual.rotation`、`getRenderConfig(item).audio.volume`。
- 属性面板和 keyframe control 写入统一走 patch API。
- 文本重建逻辑直接更新 `baseRenderConfig.visual.width/height` 和 `baseRenderConfig.text`。
- 创建默认 timeline item 时，基础属性放 `baseRenderConfig`；只有用户显式启用或设置过的 mask/filter/transition 才写入 `exRenderConfig`，新建 item 不附带默认 mask。

## 开发防回归约束

这次迁移中最容易出问题的不是类型定义，而是“预览态”和“提交态”读写路径不一致。下面这些约束要作为后续开发和 review 的检查项。

### 兼容兜底标注

迁移期所有兼容读、双写、旧 payload normalize 都必须写明原因和删除条件。推荐统一使用 `TODO(render-schema-v2-cleanup)`，这样后续可以直接搜索清理。

示例：

```ts
// TODO(render-schema-v2-cleanup): filter 迁移期兼容旧顶层 filterEffect。
// 删除条件：FilterPropertiesGroup、AnimationRegistry、ChainBuilder 全部改读 getRenderFilter 后移除。
const filter = item.exRenderConfig?.filter ?? item.filterEffect
```

要求：

- 兼容代码必须说明“兼容哪个旧字段”。
- 注释必须说明“删除条件”，不要只写“以后删除”。
- 兼容读取优先集中在 `TimelineItemQueries`、timeline item normalize、command snapshot/restore、agent codec 边界层。
- 属性面板、WebGL chain、preview overlay、动画 registry 的新代码优先调用 helper，不直接写 `?? item.filterEffect`、`?? item.transitionOut`、`?? item.config.mask`。
- 每个阶段结束时运行 `rg -n "render-schema-v2-cleanup|filterEffect|transitionOut|config\\.mask|renderFilterEffect"`，确认剩余命中都是本阶段允许的兼容点。

### 属性区控制器

属性区拖拽一般会先写 overlay 预览，松手后再提交到持久配置。如果提交时 fallback 仍从旧扁平结构读取，就会出现“拖动时能预览，松手后跳回默认值”的问题。

必须遵守：

- transform/opacity/blendMode 读取 `TimelineItemQueries.getRenderConfig(item).visual`。
- volume/mute 读取 `TimelineItemQueries.getRenderConfig(item).audio`。
- text 读取 `baseRenderConfig.text` 或 text 专用 helper。
- mask/filter 读取 `getRenderMask(item)`、`getRenderFilterEffect(item)`，不要直接读旧字段或拼路径。
- direct commit、deferred commit、overlay fallback 三处必须读同一套 render helper，不能一处读 runtime、一处读 base、一处读旧字段。

### Extra Render Config 动画

mask/filter 属于 `exRenderConfig`，它们的运行时动画结果必须写到 `runtime.exRenderConfig`，不能混入 `runtime.renderConfig`。

基础动画解析：

```ts
runtime.renderConfig.visual.x
runtime.renderConfig.visual.rotation
runtime.renderConfig.audio.volume
```

扩展动画解析：

```ts
runtime.exRenderConfig.mask
runtime.exRenderConfig.filter
```

`getRenderMask(item)` 和 `getRenderFilterEffect(item)` 负责按 `runtime.exRenderConfig -> exRenderConfig -> 旧字段兼容兜底 -> overlay` 的迁移期优先级返回最终渲染值。最终清理后移除旧字段兼容兜底，收口为 `runtime.exRenderConfig -> exRenderConfig -> overlay`。渲染链、MaskPass、FilterPass、preview overlay 都应通过这些 helper 读取。

### Mask 动画写入形状

`AnimationRegistry` 里的 mask `applyValueToConfig` 不是直接接受 `MaskConfig` 本体，而是接受包含尺寸上下文的 wrapper：

```ts
{
  mask: MaskConfig
  width: number
  height: number
}
```

因此 `resolveExtraRenderConfigAtFrame` 解析 mask 动画时必须传入这个 wrapper，然后从 `wrapper.mask` 取回结果：

```ts
const mutableMaskConfig = {
  mask: renderMask,
  width: visualConfig.width,
  height: visualConfig.height,
}

definition.applyValueToConfig(mutableMaskConfig, value)
renderMask = normalizeMaskConfig(mutableMaskConfig.mask, textureSize)
```

不要把 `renderMask` 本体直接传给 `applyValueToConfig`。否则 registry 会把结果写到 `renderMask.mask` 这种无效嵌套字段里，表现为 mask keyframe 存在但预览完全不生效。

### Mask 静态提交和动画组

mask 有两类提交：

- 数值类动画属性：`mask.center`、`mask.rotation`、`mask.feather`、`mask.intensity`、`mask.rectangle.size`、`mask.ellipse.size`、`mask.mirror.length` 等。
- 非动画配置属性：`mask.enabled`、`mask.type`、`mask.inverted`。

数值类属性必须带真实 `groupId`，并通过 `AnimationRegistry.get(groupId).applyValue(...)` 写入。原因是部分属性不是一层字段映射，例如：

- `mask.feather` 的值字段是 `outerRange`，实际写入 `mask.falloff.outerRange`。
- `mask.intensity` 的值字段是 `decayRate`，实际写入 `mask.falloff.decayRate`。

非动画配置属性不要使用占位 `groupId`。它们应走普通 `no-animation-group-patch`，直接合并到 `exRenderConfig.mask`。不要为了复用流程写 `groupId: 'mask.center'`，这会污染命令执行层对“真实动画组”和“普通配置 patch”的判断。

### 渲染链签名

普通 item 的 render chain 是否包含 `MaskPass` 由构建时的 `mask.enabled` 决定。mask 参数动画不需要进入 chain signature，因为 `MaskPass` 每帧通过 callback 读取 `getRenderMask(item)`。

但是如果一个交互会改变 `mask.enabled` 或 `mask.type`，signature 必须能变化并触发 chain 重建。当前签名至少需要包含：

```ts
mask.enabled
mask.type
```

mask center/size/rotation/feather/intensity 不应放进 signature，否则会导致每帧重建 render chain。

### 搜索清理建议

前端迁移完成后，用更精确的搜索确认没有旧结构读写残留：

```bash
rg -n "getRenderConfig\([^)]*\)\.(x|y|width|height|rotation|opacity|blendMode|volume|isMuted|mask)\b|renderConfig\.value" src/core src/components src/aipanel -g '*.ts' -g '*.vue'
rg -n "\b(item|timelineItem|textItem|sourceItem|transitionItem|selectedItem)\.(config|filterEffect|transitionOut)\b|runtime\.renderFilterEffect" src/core src/components src/aipanel -g '*.ts' -g '*.vue'
```

命中结果需要逐个判断。普通局部变量 `config`、表单 `props.config` 不属于 timeline item schema；外部 JSON diff/apply 的旧 payload 兼容入口要单独标注，不要混入属性区和渲染链路径。

## 主要影响范围

前端核心：

- `LightCut-frontend/src/core/timelineitem/bunnytype.ts`
- `LightCut-frontend/src/core/timelineitem/type.ts`
- `LightCut-frontend/src/core/timelineitem/queries.ts`
- `LightCut-frontend/src/core/animation/registry.ts`
- `LightCut-frontend/src/core/utils/animationInterpolation.ts`
- `LightCut-frontend/src/core/property-system/schema/animatablePropertySchemas.ts`

前端业务调用：

- timeline item factory / operations / text rebuild
- mask controls / filter controls / transform controls
- WebGL chain / mask pass / transition chain
- media exporter / media indexing / ASR subtitle resolver
- agent command factory / read timeline item tool / timeline JSON export and diff apply

后端 agent timeline：

- `backend/schemas/agent/timeline_models.py`
- `backend/services/agent/timeline_codec.py`

后端 codec 的 v2 行为：

- transform snapshot 从 `baseRenderConfig.visual` 读取。
- audio snapshot 从 `baseRenderConfig.audio` 读取。
- text snapshot 从 `baseRenderConfig.text` 读取。
- `exRenderConfig.mask/filter/transition` 作为 JSON 高级字段保留；当前 XML v1 worktree 不展开表达这些高级对象，除非另行设计 `mask.xml`、`filter.xml`、`transition.xml`。

## 实施顺序

整体顺序必须是：先做前端 `exRenderConfig` 渐进迁移，再做 `baseRenderConfig`，最后进入后端 agent timeline schema/codec 迁移。不要前后端交错改，否则 timeline JSON 的中间状态很容易同时兼容两套未完成结构。

### Phase 0：引入 exRenderConfig 兼容层

目标：只增加新结构和 helper，不改变现有行为。

1. 类型层新增 `TimelineExtraRenderConfig`，在 `UnifiedTimelineItemData` 上新增可选 `exRenderConfig?: TimelineExtraRenderConfig`。
2. 暂时保留旧 `config`、`transitionOut`、`filterEffect`、`runtime.renderFilterEffect`。
3. 在 `TimelineItemQueries` 新增：
   - `getExtraRenderConfig(item)`
   - `getRenderMask(item)`
   - `getRenderFilter(item)` 或兼容现有命名 `getRenderFilterEffect(item)`
   - `getRenderTransition(item)`
   - `patchExtraRenderConfig(item, patch)`
4. helper 内允许兼容兜底，例如 `exRenderConfig?.filter ?? filterEffect`，但必须加 `TODO(render-schema-v2-cleanup)` 和删除条件。
5. 这一阶段不迁移调用点，只验证新增 API 编译通过。

### Phase 1：迁移 filter 到 exRenderConfig

目标：先拿最独立的扩展渲染项试水。

1. 把 filter 读路径收敛到 `TimelineItemQueries.getRenderFilter/getRenderFilterEffect`。
2. 迁移范围优先包括：
   - `FilterPropertiesGroup` 和 filter composables
   - `UpdateFilterEffectCommand`
   - `AnimationRegistry` 的 filter intensity / dynamic params
   - `ChainBuilder`、`TransitionChainBuilder` 中的 filter package 和 render filter 读取
   - autosave、media dependency scan、history snapshot/restore
3. 迁移期间 filter 写入可以双写 `exRenderConfig.filter` 和旧 `filterEffect`，双写处必须标注删除条件。
4. 当所有 filter 业务读路径都走 helper 后，删除旧 `filterEffect` 写入，只保留必要的旧 payload normalize 入口。
5. 阶段验收搜索：

```bash
rg -n "filterEffect|renderFilterEffect|render-schema-v2-cleanup" src/core src/components src/aipanel -g '*.ts' -g '*.vue'
```

剩余 `filterEffect` 命中必须是明确标注的兼容入口或待清理清单。

### Phase 2：迁移 transition 到 exRenderConfig

目标：把顶层 `transitionOut` 收敛到 `exRenderConfig.transition`。

1. 把 transition 读路径收敛到 `TimelineItemQueries.getRenderTransition(item)`。
2. 迁移范围优先包括：
   - `UnifiedTimelineTransitionOverlay`
   - `UnifiedTimelineClip` 的 transition asset 展示
   - `TransitionPropertiesGroup`
   - `UpdateTransitionOutCommand`
   - `TransitionChainBuilder`
   - transition overlap/duration 计算
   - autosave、media dependency scan、history snapshot/restore
3. 迁移期间 transition 写入可以双写 `exRenderConfig.transition` 和旧 `transitionOut`，双写处必须标注删除条件。
4. 当所有 transition 业务读路径都走 helper 后，删除旧 `transitionOut` 写入，只保留必要的旧 payload normalize 入口。
5. 阶段验收搜索：

```bash
rg -n "transitionOut|render-schema-v2-cleanup" src/core src/components src/aipanel -g '*.ts' -g '*.vue'
```

剩余 `transitionOut` 命中必须是明确标注的兼容入口或待清理清单。

### Phase 3：迁移 mask 到 exRenderConfig

目标：把 `config.mask` 拆到 `exRenderConfig.mask`，但仍保留旧扁平 `config` 作为 base render。

1. 把 mask 读路径收敛到 `TimelineItemQueries.getRenderMask(item)`。
2. 迁移范围优先包括：
   - mask properties state / deferred interaction / keyframe controls
   - `AnimationRegistry` 的 mask groups
   - `ChainBuilder`、`TransitionChainBuilder` 中的 mask pass 和 signature
   - preview `MaskOverlay`
   - history snapshot/restore
3. 迁移期间 mask 写入可以双写 `exRenderConfig.mask` 和旧 `config.mask`，双写处必须标注删除条件。
4. 注意本阶段不要拆 `config.x/width/height`。mask 尺寸上下文仍从旧 `config.width/height` 或 `getRenderConfig(item)` 获得。
5. 当所有 mask 业务读路径都走 helper 后，删除旧 `config.mask` 写入，只保留必要的旧 payload normalize 入口。
6. 阶段验收搜索：

```bash
rg -n "config\\.mask|getRenderConfig\\([^)]*\\)\\.mask|render-schema-v2-cleanup" src/core src/components src/aipanel -g '*.ts' -g '*.vue'
```

剩余 `config.mask` 命中必须是明确标注的兼容入口或待清理清单。

### Phase 4：迁移 baseRenderConfig

目标：最后再拆基础渲染配置，避免和扩展渲染迁移互相放大风险。

1. 定义 `TimelineBaseRenderConfig<T>`，把 `VisualProps` 中的 `mask` 移除。
2. 把默认 item 创建、文本重建、transform/audio/text 属性提交迁移到 `baseRenderConfig`。
3. `getRenderConfig(item)` 改为返回分组式结构，并提供迁移期旧 `config` normalize。
4. 更新 property schema target、`AnimationRegistry` 基础动画读写路径、`resolveRenderConfigAtFrame`，使基础动画输出到分组式 `runtime.renderConfig`。
5. 渲染链、属性面板、agent 前端调用点改读分组 helper，不直接读旧 `config.x/config.width/config.volume/config.text`。
6. 阶段验收搜索：

```bash
rg -n "getRenderConfig\\([^)]*\\)\\.(x|y|width|height|rotation|opacity|blendMode|volume|isMuted|mask)\\b|\\b(item|timelineItem|textItem|sourceItem|selectedItem)\\.config\\b|render-schema-v2-cleanup" src/core src/components src/aipanel -g '*.ts' -g '*.vue'
```

剩余旧 `config` 命中必须是普通局部变量、明确标注的旧 payload normalize 入口，或待清理清单。

### Phase 5：前端旧结构清理

目标：完成前端最终态。

1. 移除 `filterEffect`、`transitionOut`、`config.mask`、`runtime.renderFilterEffect` 的兼容双写。
2. 移除旧 `config` 的业务读写，只保留明确需要的旧项目数据导入/normalize 入口。如果决定 schema v2 完全不兼容旧项目数据，也删除这些入口。
3. 新建、保存、导出、agent payload 只输出 `baseRenderConfig` 和 `exRenderConfig`。
4. 前端 `npm run build` 和 `npm run lint` 必须通过后，才能进入后端迁移。

### Phase 6：后端 agent timeline 迁移

1. 后端 schema 更新
   - `TimelineItemJson` 的 normalize 逻辑改读 `baseRenderConfig.visual`、`baseRenderConfig.audio`、`baseRenderConfig.text`。
   - 是否保留旧 `config` fallback 由最终兼容策略决定；如果保留，必须标注 `TODO(render-schema-v2-cleanup)` 和删除条件。

2. 后端 codec 更新
   - `json_to_snapshot`、`snapshot_to_json` 和 XML compile 路径使用 v2 字段。
   - 当前 XML v1 worktree 仍只展开 transform/text/audio 这类基础字段。
   - `exRenderConfig.mask/filter/transition` 作为 JSON 高级字段保留，不在本次展开为 XML 文件。

3. 后端验证
   - 补充或更新后端 timeline schema/codec 测试。
   - 运行 backend pytest。

## 验证计划

自动验证：

```bash
cd LightCut-frontend && npm run build
cd LightCut-frontend && npm run lint
```

前端验证通过后再做后端，并运行：

```bash
cd backend && pytest backend/tests
```

手动验证：

- 新增 video/image/audio/text item 后能正常预览。
- transform、opacity、volume keyframe 能正常插值。
- 属性区拖拽 transform rotation/position/size/opacity 时，拖动过程中预览正确，松手提交后数值不跳回默认值。
- mask 开关、类型、中心点、羽化、强度、尺寸 keyframe 能正常预览。
- mask center/rotation/feather/intensity/rectangle size/ellipse size/mirror length 创建两个不同关键帧后，播放头移动时能看到连续插值。
- mask feather 和 intensity 提交后要确认实际改变的是 `falloff.outerRange` 和 `falloff.decayRate`，不是写到顶层无效字段。
- mask enabled/type/inverted 提交后能立即触发预览更新；enabled/type 改变需要确认 render chain 会重建，center/size/rotation/feather/intensity 改变不应导致每帧重建 chain。
- filter intensity 和动态参数 keyframe 能正常预览。
- 文本修改后 bitmap 内容和 visual 尺寸正常更新。
- transition overlay 和转场渲染正常。
- agent timeline export/apply 后 timeline item 只包含 `baseRenderConfig` 和 `exRenderConfig`，不再包含旧 `config`、顶层 `transitionOut`、顶层 `filterEffect`。

回归搜索：

```bash
cd LightCut-frontend
npm run type-check:no-generate
rg -n "getRenderConfig\([^)]*\)\.(x|y|width|height|rotation|opacity|blendMode|volume|isMuted|mask)\b|renderConfig\.value" src/core src/components src/aipanel -g '*.ts' -g '*.vue'
rg -n "\b(item|timelineItem|textItem|sourceItem|transitionItem|selectedItem)\.(config|filterEffect|transitionOut)\b|runtime\.renderFilterEffect" src/core src/components src/aipanel -g '*.ts' -g '*.vue'
```

## 明确取舍

- 最终保存、导出、agent payload 只输出 schema v2；旧项目数据导入兼容是否长期保留，作为独立策略决定。
- 迁移过程允许短期兼容兜底，但所有兼容点必须使用 `TODO(render-schema-v2-cleanup)` 标注原因和删除条件。
- `exRenderConfig` 使用 `mask`、`transition`、`filter` 三个短字段名。
- `baseRenderConfig` 使用严格媒体类型映射，而不是统一可选分组。
- `GetAnimationMap` 保留，动画目标和 apply 路径重构。
- `runtime.renderConfig` 和 `baseRenderConfig` 同形状。
- `runtime.exRenderConfig` 和 `exRenderConfig` 同形状，用于 mask/filter 动画后的运行时值。
- 播放/预览的动画插值只写 `runtime`，不回写持久配置。
- XML worktree 仍保持当前 v1 能力；高级效果对象是否展开为 XML 文件另开方案。
