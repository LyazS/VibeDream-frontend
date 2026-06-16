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

本方案目标是做一次破坏性 schema v2：拆掉旧 `config`，改成分组式基础渲染配置和统一扩展渲染配置。

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

这次迁移不保留旧字段读取兼容。新建、保存、导出、agent payload 只输出 v2 结构。

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

`getRenderMask(item)` 和 `getRenderFilterEffect(item)` 负责按 `runtime.exRenderConfig -> exRenderConfig -> overlay` 的优先级返回最终渲染值。渲染链、MaskPass、FilterPass、preview overlay 都应通过这些 helper 读取。

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

整体顺序必须是：先完成前端全部迁移和前端验证，再进入后端 agent timeline schema/codec 迁移。不要前后端交错改，否则 timeline JSON 的中间状态很容易同时兼容两套未完成结构。

### Phase 1：前端完整迁移

1. 类型层改造
   - 定义 `TimelineBaseRenderConfig<T>` 和 `TimelineExtraRenderConfig`。
   - 从 `VisualProps` 移除 `mask`。
   - 把 `UnifiedTimelineItemData.config` 改为 `baseRenderConfig`。
   - 把顶层 `transitionOut/filterEffect` 移到 `exRenderConfig.transition/filter`。

2. Helper 和查询层
   - 新增分组访问、patch、render 查询 API。
   - 先让所有新 API 编译通过，再迁移调用点。

3. 动画系统
   - 更新 property schema target。
   - 更新 `AnimationRegistry` 的读写路径。
   - 更新 `resolveRenderConfigAtFrame`，使基础动画输出分组式 `runtime.renderConfig`。
   - 新增 `resolveExtraRenderConfigAtFrame` 或等价逻辑，使 mask/filter 动画输出到 `runtime.exRenderConfig`。
   - 确保按帧动画 apply 不回写 `baseRenderConfig` 或 `exRenderConfig`。

4. 渲染和属性面板
   - WebGL、preview、mask overlay 改读新查询 API。
   - transform/audio/text/mask/filter 控件改写新 patch API。

5. 创建、导出和前端 agent 调用点
   - 所有默认 item 创建函数输出 v2。
   - timeline JSON export/apply 输出和合并 v2 字段。
   - 前端 agent command factory、read timeline item tool、timeline JSON diff/apply 全部改为 v2 字段。

6. 前端旧结构清理
   - 全仓搜索并移除 `item.config`、`transitionOut`、`filterEffect` 的旧 timeline item 用法。
   - 注意不要误改无关模块里的普通 `config` 变量。
   - 前端 `npm run build` 和 `npm run lint` 必须通过后，才能进入 Phase 2。

### Phase 2：后端 agent timeline 迁移

1. 后端 schema 更新
   - `TimelineItemJson` 的 normalize 逻辑改读 `baseRenderConfig.visual`、`baseRenderConfig.audio`、`baseRenderConfig.text`。
   - 不再读取旧 `config` 作为 transform/text fallback。

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

- 这是破坏性 schema v2，不兼容旧项目数据结构。
- `exRenderConfig` 使用 `mask`、`transition`、`filter` 三个短字段名。
- `baseRenderConfig` 使用严格媒体类型映射，而不是统一可选分组。
- `GetAnimationMap` 保留，动画目标和 apply 路径重构。
- `runtime.renderConfig` 和 `baseRenderConfig` 同形状。
- `runtime.exRenderConfig` 和 `exRenderConfig` 同形状，用于 mask/filter 动画后的运行时值。
- 播放/预览的动画插值只写 `runtime`，不回写持久配置。
- XML worktree 仍保持当前 v1 能力；高级效果对象是否展开为 XML 文件另开方案。
