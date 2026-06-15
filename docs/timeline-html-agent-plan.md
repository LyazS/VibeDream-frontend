# Timeline XML Workspace Agent 工具方案

## Summary

- 新增一套 Agent 时间轴编辑方式：把当前 `tracks + timelineItems` 序列化为 `/timeline` 虚拟文件夹，Agent 像编辑代码仓库一样按文件读写 XML。
- 借鉴 `new-atoms` 的 workspace 思路：`/timeline` 不是执行层，而是 timeline 的 worktree/staging area；Agent 在草稿工作区内“列目录、读文件、写文件、校验运行”，直到 apply 时再影响真实时间轴。
- v1 隐藏 `edit_sdk`：后端工具注册和系统 prompt 不再暴露 `edit_sdk`，但前端实现先保留旧代码便于回滚。
- v1 只实现基础时间轴和 `transform.xml`；目录结构预留 `filter.xml`、`keyframes.xml`、`transition.xml`、`mask.xml` 等后续扩展位。
- 长期方向不是每次全量替换 timeline graph，而是把 XML worktree 与当前真实 timeline 做三方对比，解析成 typed snapshot 后做语义 diff apply；全量重建保留为导入、恢复、兜底和测试基准。

## Key Changes

- 新增前端工具：
  - `list_timeline_files(path, recursive)`：列出 `/timeline` 虚拟目录内容。
  - `read_timeline_files(paths)`：读取一个或多个 timeline XML 文件。
  - `write_timeline_file(path, content)`：覆盖前端内存草稿中的单个 XML 文件，不直接改真实时间轴。
  - `validate_timeline_workspace()`：解析整个 `/timeline` 草稿、校验、生成规范化 timeline snapshot；v1 可以在校验通过后立即 apply，长期应拆分出 apply/reconcile 阶段。
  - `apply_timeline_workspace()`（长期）：把 workspace 的 base snapshot、当前 XML worktree、当前真实 timeline 做对比，生成 `EditPlan/CommandPlan` 后应用。
  - `generate_timeline_ids(kind, count)`：批量生成 `track` 或 `clip` ID，分别复用 `generateTrackId()` 和 `generateTimelineItemId()`。
- 新增后端 `FrontendToolProxy` schema，并注册上述工具；从后端注册表中移除或条件隐藏 `edit_sdk`。
- 更新系统 prompt：
  - 时间轴编辑优先使用 `list_timeline_files -> read_timeline_files -> generate_timeline_ids(需要新增时) -> write_timeline_file -> validate_timeline_workspace -> task_complete`。
  - Agent 不再通过 JS 调用 `edit_sdk` 编辑时间轴。
  - 新增 track/clip 必须先调用 ID 工具，不允许手写随机 ID。

## Workspace Worktree Model

XML 方案的核心定位是 timeline worktree，而不是直接编辑真实 timeline。

类比代码仓库：

```text
real timeline at checkout time -> base snapshot
/timeline XML files            -> working tree
real timeline at apply time    -> current timeline
```

Agent 的常规循环发生在 working tree 内：

```text
checkout/serialize -> read XML -> write XML draft -> validate draft -> fix draft -> apply
```

在 `apply` 之前，真实时间轴保持不变。这样 Agent 可以在草稿层反复试错、修复 validation error、批量调整结构，而不会把中间状态写进真实 command/history。

apply 时必须基于三份状态做对比：

```text
agent patch = diff(base snapshot, working tree snapshot)
user patch  = diff(base snapshot, current timeline snapshot)

if patches do not conflict:
  apply agent patch onto current timeline
else:
  return structured conflict report
```

这个模型带来的约束：

- workspace 创建时必须记录 `baseRevision` 和 base snapshot；只记录当前 XML 不够。
- `write_timeline_file` 只修改 working tree，不修改真实时间轴，也不应该产生 undo 历史。
- `validate_timeline_workspace` 只证明 working tree 自洽；它不能证明 working tree 一定能覆盖当前真实 timeline。
- `apply_timeline_workspace` 或 v1 的 validate+apply 阶段必须重新读取 current timeline，并检查 base 是否 stale。
- 如果 Agent 编辑期间用户手动修改了真实 timeline，apply 不应盲目覆盖；首版可以直接拒绝，长期做字段级 conflict/rebase。
- apply 的输出应该是 `EditPlan/CommandPlan`，再进入现有 command/history/property-system；XML worktree 不是 store patch 格式。

## Timeline Workspace Contract

虚拟文件夹固定挂载在 `/timeline`：

```text
/timeline/
  main.xml
  /track_v1/
    main.xml
    /item_a/
      main.xml
      transform.xml
    /item_b/
      main.xml
      transform.xml
  /track_t1/
    main.xml
    /item_subtitle_1/
      main.xml
      transform.xml
      text.xml
```

`/timeline/main.xml` 只表达时间轴级元信息和轨道顺序：

```xml
<timeline version="1" fps="30">
  <track ref="track_v1" index="0" />
  <track ref="track_t1" index="1" />
</timeline>
```

`/timeline/{trackId}/main.xml` 表达轨道属性和片段顺序：

```xml
<track id="track_v1" type="video" name="Video 1" visible="true" muted="false">
  <clip ref="item_a" index="0" />
  <clip ref="item_b" index="1" />
</track>
```

`/timeline/{trackId}/{clipId}/main.xml` 表达片段身份、素材引用和时间范围：

```xml
<clip id="item_a" mediaItemId="media_x.mp4" mediaType="video"
      start="00:00:00+00" end="00:00:05+00"
      clipStart="00:00:00+00" clipEnd="00:00:05+00" />
```

`/timeline/{trackId}/{clipId}/transform.xml` 表达画布变换：

```xml
<transform x="0" y="0" width="1920" height="1080"
           rotation="0" opacity="1" />
```

文本片段额外使用 `/timeline/{trackId}/{clipId}/text.xml`：

```xml
<text fontSize="48" color="#ffffff">字幕内容</text>
```

v1 支持文件：

- `/timeline/main.xml`
- `/timeline/{trackId}/main.xml`
- `/timeline/{trackId}/{clipId}/main.xml`
- `/timeline/{trackId}/{clipId}/transform.xml`
- `/timeline/{trackId}/{clipId}/text.xml`，仅文本片段需要

后续预留但 v1 不启用：

- `/timeline/{trackId}/{clipId}/audio.xml`
- `/timeline/{trackId}/{clipId}/filter.xml`
- `/timeline/{trackId}/{clipId}/keyframes.xml`
- `/timeline/{trackId}/{clipId}/transition.xml`
- `/timeline/{trackId}/{clipId}/mask.xml`

## Field Ownership

- `main.xml`：identity、track order、clip order、media reference、timing。
- `transform.xml`：`x`、`y`、`width`、`height`、`rotation`、`opacity`。
- `text.xml`：文本内容和 v1 基础文本样式。
- v1 只覆盖基础字段：轨道顺序/名称/类型/可见/静音，片段时间、素材引用、基础视觉属性、文本内容和基础样式。
- XML workspace 未表达的高级字段全部丢弃：`animation`、`filterEffect`、`transitionOut`、`mask`、`provenance` 等不会保留。

## Apply Behavior

- `validate_timeline_workspace` 通过后立刻应用，不再需要单独 apply 工具。
- v1 应用方式是全量替换 timeline graph：
  - 清空并重建 `tracks`。
  - 清空并重建 `timelineItems`。
  - 不触碰 `mediaItems`、目录树、本地文件句柄、索引结果、缩略图/波形缓存和项目元信息。
- 新增 `ReplaceTimelineFromWorkspaceCommand` 或等价 history command：
  - `execute()` 清理旧 timeline item runtime，重建新 timeline。
  - `undo()` 恢复应用前的 `tracks + timelineItems`。
  - `redo()` 再次应用 XML workspace 生成的目标 timeline。
  - 所有重建 item 走 `TimelineItemFactory.buildForDag()`，不要直接把裸对象塞进 store。
- 应用后清空 timeline/library 选择状态，保留当前播放头。
- 同轨道重叠允许应用，但在 XML 报告里返回 warning。
- 非文本 `mediaItemId` 只要求存在，不要求 ready；后续状态交给现有 DAG/ready resolver。

## Long-term Diff Apply

长期 XML workspace 的常规应用方式应是语义 diff，而不是 XML 文本 diff 或每次全量替换。

目标数据流：

```text
current timeline graph -> current TimelineSnapshot
target XML workspace -> parse -> validate -> normalize -> target TimelineSnapshot
current + target -> semantic diff -> EditPlan/CommandPlan -> existing commands/property-system
```

核心约束：

- XML 是完整目标状态；diff apply 负责把当前时间轴收敛到目标状态。
- diff 的输入是规范化后的 typed snapshot，不是 XML 字符串、文件顺序、空白或属性顺序。
- `trackId` 和 `clipId` 是对象身份来源；同 ID 对象在新旧 snapshot 中同时存在时，应优先解释为 move/update/resize，而不是 remove+add。
- 新增 track/clip 仍必须使用 `generate_timeline_ids` 或编辑器 ID 生成器，不允许 Agent 手写随机 ID。
- diff apply 输出必须是 `EditPlan` 或内部 `CommandPlan`，再交给现有 commands、history 和 property-system；不要直接 patch store。
- 全量重建能力仍必须存在，用于导入、恢复、兜底和验证 diff apply 结果是否等价。

规范化 snapshot 形态：

```ts
type TimelineSnapshot = {
  revision: string
  tracksById: Record<string, TrackSnapshot>
  trackOrder: string[]
  clipsById: Record<string, ClipSnapshot>
  clipOrderByTrackId: Record<string, string[]>
}
```

规范化阶段负责补齐默认值、解析时间码到帧、排序引用、校验路径 ID 与 XML ID 一致，并把等价 XML 表示折叠成稳定数据结构。

推荐的 semantic diff 执行顺序：

1. 校验 target XML 完整性；失败不改真实时间轴，保留草稿。
2. 检查 workspace base revision；如果 Agent 基于旧时间轴编辑，而当前时间轴已被用户改动，返回 conflict 或进入冲突检测流程。
3. 创建 target 中新增的 track，保证后续 clip 有合法目标轨道。
4. 更新已有 track 的名称、类型外属性、静音/可见状态，并按 target `trackOrder` 重排轨道。
5. 删除 target 中不存在的 clip；如果这些 clip 属于待删除 track，先删 clip，再删 track。
6. 创建 target 中新增的 clip，并挂到目标 track。
7. 对新旧都存在的 clip，根据 target `clipOrderByTrackId` 移动到目标 track 和目标顺序位置。
8. 应用 clip 时间范围、素材裁剪范围、播放速率等 timing 变化。
9. 应用 clip 属性变化：`transform.xml`、`text.xml`、`audio.xml`、`filter.xml`、`mask.xml`、`keyframes.xml` 等都应编译到 property-system 或对应命令，不裸改 `item.config`。
10. 删除 target 中不存在且已清空的 track。

冲突与高级对象：

- `revision` 用来防止 stale workspace 覆盖用户手动改动；首版可以在 revision 不匹配时拒绝 apply。
- 后续可以做字段级冲突检测：Agent 只改了 clip A，用户只改了 clip B 时允许合并；同一 clip 同一字段同时变更时报 conflict。
- 未来 `filter`、`transition`、`mask`、关键帧组等高级对象也应有稳定 ID 或稳定路径，否则只能退化为整块替换或 unsupported error。
- 对 clip resize 后关键帧如何保持，需要明确产品语义：保持绝对时间、保持相对时间或按比例缩放，不能由通用 diff 自动猜测。

## Validation

`validate_timeline_workspace` 返回结构化 XML 报告：

```xml
<validation success="false">
  <error code="MISSING_FILE" path="/timeline/track_v1/item_a/transform.xml" message="缺少 transform.xml" />
  <error code="UNKNOWN_MEDIA" path="/timeline/track_v1/item_a/main.xml" id="item_a" message="mediaItemId 不存在" />
  <warning code="OVERLAP" trackId="track_v1" ids="item_a,item_b" />
</validation>
```

必须校验：

- 路径白名单、XML 标签白名单、属性白名单、必填字段。
- `/timeline/main.xml` 引用的 track 目录必须存在。
- track `main.xml` 引用的 clip 目录必须存在。
- track ID、clip ID 在路径、XML 内容和引用中一致。
- ID 唯一性；已有/新增 ID 格式不强制，但不能重复。
- track 类型和 clip `mediaType` 匹配：video 轨道允许 `video | image`，audio 轨道只允许 `audio`，text 轨道只允许 text 片段。
- 时间码为 `HH:MM:SS+FF` 且 30 FPS 范围合法。
- `end > start`，视频/音频 `clipEnd > clipStart`。
- 非文本 clip 的 `mediaItemId` 存在且 media type 与轨道兼容。
- text 片段必须有 `text.xml`；非 text 片段不能有 `text.xml`。
- 缺省文本样式用现有 `DEFAULT_TEXT_STYLE`。
- 校验失败不改真实时间轴，保留草稿供 Agent 继续修复。

## Test Plan

- 单元测试 serializer/parser：
  - 空时间轴、单轨单片段、多轨混合 video/image/audio/text。
  - track/clip 顺序在 `main.xml` 和目录中往返一致。
  - 特殊字符文本转义与反转义。
  - 时间码和帧数双向转换。
- 单元测试 validation：
  - 缺文件、重复 ID、路径 ID 与 XML ID 不一致、未知素材、轨道类型不匹配、非法时间码、end 小于 start。
  - text 片段缺少 `text.xml` 失败。
  - 重叠只产生 warning，不阻止应用。
- 命令测试：
  - `validate_timeline_workspace` 成功后 timeline 被替换。
  - Undo 恢复旧 tracks/items，Redo 恢复新 tracks/items。
  - 应用后选择清空，播放头不变。
- 长期 diff apply 测试：
  - 新增/删除/重命名/重排 track 生成正确命令。
  - 新增/删除 clip、跨轨移动 clip、同轨重排 clip 不退化为全量替换。
  - 只修改 clip 属性时只生成 property-system 变更。
  - stale revision 被拒绝或返回结构化 conflict。
  - 对同一 target XML，diff apply 结果与 full rebuild 结果在持久字段上等价。
- Agent 工具测试：
  - `list -> read -> write -> validate` 成功闭环。
  - 修改单个 clip 只需写对应 clip 文件。
  - 新增轨道/片段必须先通过 `generate_timeline_ids` 获取 ID。
  - 后端工具列表不暴露 `edit_sdk`。

## Assumptions

- v1 追求 Agent 成功率和实现简单性，接受全量替换 timeline graph；长期版本以 semantic diff apply 作为常规应用路径。
- XML workspace 是基础时间轴字段的唯一真相源；未表达高级字段直接丢弃。
- 草稿只存在前端内存里，刷新或新会话后丢失。
- 旧 `edit_sdk` 代码保留但不暴露给模型，后续可按配置开关回滚。
