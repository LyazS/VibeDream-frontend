# Timeline XML Backend Worktree Agent 快速验证方案

## Summary

本方案先验证一条最短闭环：**前端把当前时间轴发给后端，后端 materialize 成 XML worktree，Agent 只编辑后端 XML，完成后后端把目标时间轴返回给前端，前端直接全量应用后端返回版本。**

v1 暂时不做三方冲突合并，也不实现 `TimelineMergeEngine`。如果 Agent 编辑期间用户继续手动改时间轴，最终 apply 会以 **后端返回的目标版本为准**，覆盖这期间的本地时间轴改动。这个取舍可以显著降低首版复杂度，用来快速验证：

- JSON timeline bundle 能否稳定发到后端。
- 后端能否把 timeline 转成 `/timeline` XML worktree。
- Agent 能否通过 XML 工具完成编辑。
- 后端能否 validate XML 并编译回前端可应用的 timeline 数据。
- 前端能否通过现有 command/history 体系全量替换 `tracks + timelineItems`，并支持 undo/redo。

长期的冲突检测、字段级合并、语义 diff apply 先作为后续阶段，不进入快速验证版本。

## Scope

### v1 做

- 每轮 Agent 时间轴编辑开始时，前端导出当前 timeline JSON。
- 后端保存 round state，并生成 `/timeline` XML worktree。
- Agent 使用后端 XML worktree 工具读写时间轴，不再直接调用前端 `edit_sdk`。
- 后端提供基础 XML 文件工具和少量结构化 timeline 工具。
- Agent 完成后调用 `timeline_apply_request()`。
- 后端 validate 当前 XML worktree，并编译出目标 `TimelineJsonBundle` 或 `TimelineSnapshot`。
- 前端收到 apply payload 后直接全量替换当前真实 timeline。
- apply 必须进入现有 command/history 体系，支持 undo/redo。
- 素材库、目录树、本地文件句柄、缩略图、波形缓存、项目元信息不被替换。

### v1 不做

- 不做 `base / agent / latest` 三方合并。
- 不做 `TimelineMergeEngine`。
- 不做 conflict report 和 Agent conflict resolution loop。
- 不做字段级 rebase。
- 不做局部 command plan apply。
- 不保证 Agent 编辑期间用户手动改动能保留。
- 不覆盖复杂高级对象：filter、keyframes、transition、mask 等先不纳入 XML schema。

## Design Position

XML 是后端 Agent 的可编辑工作区，不是前端 store patch。

数据流：

```text
frontend current timeline
  -> TimelineJsonBundle
  -> backend normalized snapshot
  -> backend /timeline XML worktree
  -> Agent edits XML
  -> backend validate + compile target timeline
  -> frontend full replace apply
```

v1 的关键点是把 Agent 从真实前端时间轴上移开。Agent 可以在后端 XML worktree 里反复读、写、校验、修正；只有最终 apply payload 回到前端时，才改真实 timeline。

## Round Lifecycle

### 1. User Message Starts A Round

用户发送一条会编辑时间轴的 Agent 消息时，前端导出当前时间轴：

```text
current frontend timeline -> TimelineJsonBundle
```

发送给后端：

```http
POST /api/agent-rounds
Content-Type: application/json
```

请求结构：

```ts
type StartAgentRoundRequest = {
  /** 用户本轮发给 Agent 的自然语言消息。 */
  message: string
  /** 用户发消息时导出的 timeline 内容。 */
  timeline: TimelineJsonBundle
}

type TimelineJsonBundle = {
  /** 项目 ID，用于把 round 绑定到具体项目。 */
  projectId: string
  /** 当前时间轴的轨道列表，顺序代表轨道显示/合成顺序。 */
  tracks: TimelineTrackJson[]
  /** 当前时间轴的 clip/item 列表，包含稳定 item ID 和时间范围。 */
  timelineItems: TimelineItemJson[]
  /** v1 XML schema 无法完整表达的高级状态报告。 */
  unsupportedState?: UnsupportedTimelineStateReport
}
```

后端收到后：

- 解析 JSON 为 typed `TimelineSnapshot`。
- 规范化字段、顺序、默认值和 frame 单位。
- 序列化为 `/timeline` XML 文件树。
- 保存 `baseJson`、`baseFiles` 和 `workingFiles`。
- 创建 Agent round workspace。

```ts
type AgentTimelineRound = {
  roundId: string
  projectId: string
  baseJson: TimelineJsonBundle
  baseFiles: Record<string, string>
  workingFiles: Record<string, string>
  status: "editing" | "ready_to_apply" | "applied" | "discarded" | "failed"
}
```

`baseFiles` v1 主要用于调试、回放和未来扩展；apply 时不参与冲突合并。

### 2. Backend Materializes XML Worktree

后端把 timeline snapshot materialize 成固定 XML 文件结构：

```text
/timeline/
  main.xml
  /track_v1/
    main.xml
    /item_a/
      main.xml
      transform.xml
  /track_t1/
    main.xml
    /item_subtitle_1/
      main.xml
      transform.xml
      text.xml
```

`workingFiles` 初始等于 `baseFiles`。之后 Agent 只编辑 `workingFiles`，不直接改前端真实 timeline。

### 3. Agent Edits Worktree

Agent 使用后端 XML workspace 工具：

文件树工具：

- `timeline_ls(path, recursive)`
- `timeline_read(paths)`
- `timeline_write(path, content)`
- `timeline_edit(path, edits)`
- `timeline_grep(pattern, path)`
- `timeline_mkdir(path)`
- `timeline_rm(path, recursive)`
- `timeline_mv(from, to)`

结构化 timeline 工具：

- `timeline_create_track(id?, type, name, index)`
- `timeline_delete_track(trackId, deleteClips)`
- `timeline_create_clip(trackId, clipId?, mediaType, mediaItemId, startFrame, endFrame, index)`
- `timeline_delete_clip(clipId)`
- `timeline_move_clip(clipId, toTrackId, index)`

生命周期工具：

- `timeline_validate()`
- `timeline_generate_ids(kind, count)`
- `timeline_apply_request()`

素材查询工具继续复用现有只读工具：

- `list_contents(filePath, offset, limit)`
- `search_media(query, top_k)`
- `read_media(mediaIds, fields)`

推荐 Agent 循环：

```text
ls/read/grep -> edit/write or structural tool -> validate -> fix validation errors -> apply_request
```

新增、删除、移动 track/clip 优先使用结构化工具，避免 Agent 手动维护跨文件引用时漏改。

### 4. Agent Requests Apply

Agent 完成编辑后调用：

```ts
timeline_apply_request({})
```

后端执行：

```text
workingFiles -> validate -> parse snapshot -> compile target timeline payload
```

validate 失败时：

- 不生成 apply payload。
- 返回结构化 validation issue 给 Agent。
- Agent 继续修改 `workingFiles` 后再次 validate/apply。

validate 成功时，后端向前端发送：

```ts
type AgentApplyPayload = {
  /** 对应的 Agent round ID。 */
  roundId: string
  /** 后端 XML worktree 编译出的目标 timeline。 */
  targetTimeline: TimelineJsonBundle
  /** Agent 最终 XML 文件树，用于调试或展示 diff。 */
  agentFiles?: Record<string, string>
  /** 后端 validate/compile 产生的非阻断问题。 */
  warnings: TimelineWorkspaceIssue[]
}
```

v1 payload 不需要携带 `latestFiles`、`agentPatch`、`conflicts` 或 `mergedSnapshot`。

### 5. Frontend Direct Apply

前端收到 `AgentApplyPayload` 后直接应用 `targetTimeline`：

```text
targetTimeline -> ReplaceTimelineFromBackendCommand -> real timeline
```

建议新增 `ReplaceTimelineFromBackendCommand` 或等价 command：

- `execute()` 保存应用前的 `tracks + timelineItems`，然后全量替换为 `targetTimeline`。
- `undo()` 恢复应用前的 `tracks + timelineItems`。
- `redo()` 再次应用 `targetTimeline`。
- 新 item 仍走现有 factory / DAG 构建路径，不把裸 JSON 直接塞进 store。
- 不触碰 `mediaItems`、素材目录、本地文件句柄、缩略图、波形缓存和项目元信息。
- 应用后清空 timeline/library selection。
- 保留当前播放头。

如果产品上担心覆盖用户在 Agent 运行期间的本地编辑，v1 可以只加一个简单提示：

```text
Agent 已生成新的时间轴版本。应用后会以 Agent 返回版本替换当前时间轴，可通过 undo 撤销。
```

这只是用户确认，不是冲突检测。

## XML Workspace Contract

虚拟根目录固定为 `/timeline`。

`/timeline/main.xml` 表达 timeline 元信息和轨道顺序：

```xml
<timeline version="1">
  <track ref="track_v1" index="0" />
  <track ref="track_t1" index="1" />
</timeline>
```

`/timeline/{trackId}/main.xml` 表达轨道属性和 clip 顺序：

```xml
<track id="track_v1" type="video" name="Video 1" visible="true" muted="false">
  <clip ref="item_a" index="0" />
  <clip ref="item_b" index="1" />
</track>
```

`/timeline/{trackId}/{clipId}/main.xml` 表达 clip 身份、素材引用和时间范围：

```xml
<clip id="item_a" mediaItemId="media_x.mp4" mediaType="video"
      startFrame="0" endFrame="150"
      clipStartFrame="0" clipEndFrame="150" />
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
- `/timeline/{trackId}/{clipId}/text.xml`

v1 不启用但预留：

- `/timeline/{trackId}/{clipId}/audio.xml`
- `/timeline/{trackId}/{clipId}/filter.xml`
- `/timeline/{trackId}/{clipId}/keyframes.xml`
- `/timeline/{trackId}/{clipId}/transition.xml`
- `/timeline/{trackId}/{clipId}/mask.xml`

## Snapshot Model

JSON 和 XML 都归一化为同一种 typed snapshot，便于验证和编译：

```ts
type TimelineSnapshot = {
  tracksById: Record<string, TrackSnapshot>
  trackOrder: string[]
  clipsById: Record<string, ClipSnapshot>
  clipOrderByTrackId: Record<string, string[]>
}

type TrackSnapshot = {
  id: string
  type: "video" | "audio" | "text"
  name: string
  visible: boolean
  muted: boolean
}

type ClipSnapshot = {
  id: string
  trackId: string
  mediaType: "video" | "audio" | "image" | "text"
  mediaItemId?: string
  startFrame: number
  endFrame: number
  clipStartFrame?: number
  clipEndFrame?: number
  transform?: TransformSnapshot
  text?: TextSnapshot
}
```

规范化负责：

- 补齐默认值。
- 统一排序。
- 校验路径 ID 与 XML ID。
- 处理 XML 转义与文本内容。
- 把 JSON 和 XML frame 字段都归一为非负整数 frame。
- 记录 v1 不支持的高级字段。

## Validation Rules

必须校验：

- 路径必须位于 `/timeline` 下。
- XML 标签和属性必须在白名单内。
- XML 必须可解析，禁止外部实体和 DTD。
- `/timeline/main.xml` 引用的 track 目录必须存在。
- track `main.xml` 引用的 clip 目录必须存在。
- track ID、clip ID 在路径、XML 内容和引用中一致。
- ID 全局唯一。
- track 类型和 clip `mediaType` 匹配。
- `startFrame`、`endFrame`、`clipStartFrame`、`clipEndFrame` 必须是非负整数。
- `endFrame > startFrame`。
- 非文本 clip 必须有合法 `mediaItemId`。
- 视频/音频 clip 必须满足 `clipEndFrame > clipStartFrame`。
- 文本 clip 必须有 `text.xml`。
- 非文本 clip 不能有 `text.xml`。
- `transform.xml` 数值必须有限，`opacity` 在 `0..1`。

warning：

- 同轨重叠先返回 warning，不阻止 v1 apply。
- v1 无法表达的高级字段默认返回 warning；如果会导致明显数据丢失，可以在前端 apply 前提示用户确认。

## ID Allocation

ID 分配由后端 round 内部负责，前端不需要把 `idAllocator` 状态传给后端。

后端实现 round-scoped ID generator：

- 初始化时扫描 base snapshot 和 workingFiles，建立 `usedIds`。
- 按 kind 使用稳定前缀，例如 `track_` / `clip_`。
- 使用足够低碰撞概率的随机或 monotonic+random suffix。
- 维护本轮 `reservedIds`，避免已分配但尚未写入 worktree 的 ID 被重复发出。
- `timeline_generate_ids(kind, count)` 从该 generator 分配并 reserved。
- `timeline_create_track` / `timeline_create_clip` 未传 ID 时，也从该 generator 自动分配。

v1 不处理 apply 时刻与前端最新 timeline 新增 ID 的冲突。因为 v1 直接全量替换，目标版本里的 ID 集合就是最终 ID 集合。

## API Sketch

### Start Agent Round

```http
POST /api/agent-rounds
Content-Type: application/json
```

```ts
type StartAgentRoundRequest = {
  message: string
  timeline: TimelineJsonBundle
}

type StartAgentRoundResponse = {
  roundId: string
}
```

### Apply Request

Agent 内部调用：

```ts
timeline_apply_request({})
```

后端 validate 当前 XML worktree，并向前端发送：

```ts
type AgentApplyPayload = {
  roundId: string
  targetTimeline: TimelineJsonBundle
  agentFiles?: Record<string, string>
  warnings: TimelineWorkspaceIssue[]
}
```

### Final Apply Notification

前端成功应用后通知后端：

```http
POST /api/agent-rounds/{roundId}/applied
```

如果用户选择放弃本轮结果：

```http
POST /api/agent-rounds/{roundId}/discard
```

## Responsibilities

### Frontend

前端负责真实编辑器边界：

- 用户发消息时打包当前 timeline JSON。
- 接收后端 `AgentApplyPayload`。
- 直接应用 `targetTimeline`。
- apply 进入现有 command/history/property-system。
- 维护 undo/redo、runtime 清理、selection、playhead 和 UI 刷新。
- 可展示 warnings 和“会替换当前时间轴”的确认提示。

前端不负责：

- 暴露 XML 文件读写工具给 Agent。
- 让 Agent 调 `edit_sdk`。
- 在 Agent 编辑 worktree 期间同步中间状态到真实 timeline。
- v1 里做冲突检测、三方合并、字段级 rebase。

### Backend

后端负责 Agent 编辑事务：

- 接收 base timeline JSON。
- 把 JSON 转成 normalized snapshot。
- 把 snapshot materialize 成 XML worktree。
- 保存每轮对话的 `baseJson`、`baseFiles` 和 `workingFiles`。
- 提供 XML 专用工具给 Agent。
- 提供只读素材查询工具，让 Agent 按需获取 `mediaItemId` 和素材元数据。
- 校验 XML、生成 ID、解析 XML。
- 编译 `AgentApplyPayload`。

后端不负责：

- 直接修改前端 store。
- 写入前端 undo history。
- 假设前端 runtime 对象可以完整从 XML 恢复。
- v1 里做最终 apply-time 冲突判定。

## Agent Prompt Rules

系统 prompt 应明确：

- 时间轴编辑只通过 XML worktree 工具完成。
- 不调用 `edit_sdk`。
- 不要求前端执行中间态。
- 新增 track/clip 可以先调用 `timeline_generate_ids`，也可以让结构化创建工具自动分配 ID。
- 不手写或复用不确定的 ID。
- 修改前先 `ls/read/grep` 定位 XML 文件。
- 优先使用 `timeline_edit` 做局部 XML 修改。
- 创建、删除、移动 track/clip 时优先使用结构化工具。
- `timeline_validate` 失败必须继续修复。
- 完成后调用 `timeline_apply_request`。
- `timeline_apply_request` 只是请求前端应用，不代表 Agent 已经直接修改真实 timeline。

## Verification Gates

| Capability | Verification Method | Exit Criteria |
| --- | --- | --- |
| Minimal Contracts | schema/type fixture、示例 JSON、协议评审 | `TimelineJsonBundle`、`TimelineSnapshot`、issue、apply payload 类型能表达 v1 场景。 |
| Backend XML Codec | 后端单元测试、roundtrip fixture、稳定输出快照 | `JSON -> XML -> snapshot -> JSON` 语义等价；非法 XML 能返回结构化 validation issue。 |
| Agent Round And Worktree State | API/session 集成测试、round store 测试 | 发起 round 后能创建 `baseFiles` 和 `workingFiles`；Agent 修改 worktree 不影响真实前端 timeline。 |
| Backend Timeline Tools | 直接调用工具测试，不依赖 LLM | `ls/read/write/edit/validate/generate_ids/apply_request` 操作同一个 round worktree；validate 失败不生成 apply payload。 |
| Frontend Timeline Export | 前端 fixture、snapshot test、真实 store 导出测试 | 当前 editor store 能稳定导出 `TimelineJsonBundle`；track/clip ID、顺序、frame 字段正确。 |
| Direct Apply Path | 前后端集成测试、少量 e2e | 前端能直接应用后端返回的 `targetTimeline`；apply 走 command/history；undo/redo 正确。 |

## Test Plan

### JSON / XML Roundtrip

- 空 timeline。
- 单轨单 clip。
- 多轨多 clip。
- video/image/audio/text 混合。
- 文本特殊字符转义与反转义。
- JSON frame 与 XML frame 属性往返一致。

### XML Tools

- `timeline_ls` 能列出目录。
- `timeline_read` 能批量读取文件。
- `timeline_write` 能新增和覆盖文件。
- `timeline_edit` 能修改属性、文本、插入元素、删除元素。
- `timeline_grep` 能按 clipId、mediaItemId、文本查找。
- `timeline_mkdir` 能创建虚拟目录。
- `timeline_rm` 删除目录时必须要求 `recursive: true`。
- `timeline_mv` 移动目录后 validation 能发现路径 ID、XML ID 或引用不一致。
- invalid XML edit 被拒绝或明确保存为 invalid draft。

### Structural Tools

- `timeline_create_track` 创建 track 目录和 main.xml，并更新 `/timeline/main.xml`。
- `timeline_delete_track` 删除非空 track 时必须显式 `deleteClips: true`。
- `timeline_create_clip` 创建 clip 目录和必要 XML 文件，并更新 track `main.xml`。
- `timeline_delete_clip` 删除 clip 目录，并移除 track 内 clip 引用。
- `timeline_move_clip` 跨轨移动 clip，并更新源/目标 track 引用顺序。
- 结构化工具返回 changed paths。
- 结构化工具执行后 `timeline_validate` 通过。

### Validation

- 缺文件。
- 重复 ID。
- 路径 ID 与 XML ID 不一致。
- 素材 ID 缺失。
- 轨道类型不匹配。
- 非法 frame。
- `endFrame <= startFrame`。
- text clip 缺少 `text.xml`。
- 同轨重叠返回 warning。

### Frontend Apply

- apply 使用后端返回的 `targetTimeline`。
- apply 前保存旧 `tracks + timelineItems`。
- undo/redo 正确。
- media library 不被修改。
- selection 清空。
- playhead 保留。
- Agent 运行期间用户改动 timeline 时，最终应用以后端返回版本为准，undo 能回到应用前状态。

## Later: Conflict Merge

当 v1 闭环跑通后，再考虑引入长期正确性：

```text
base files      = 用户发消息时的 XML 文件树
agent files     = Agent 编辑后的 XML 文件树
latest files    = apply 时刻前端本地最新 XML 文件树

agent patch     = semanticDiff(base, agent)
user patch      = semanticDiff(base, latest)

if patches can merge:
  merged snapshot -> frontend apply
else:
  conflict report -> user chooses discard or ask Agent to resolve
```

后续需要新增：

- `TimelineMergeEngine`。
- typed `TimelinePatch`。
- conflict report。
- conflict resolution loop。
- 字段级 rebase。
- `mergedSnapshot + latestSnapshot -> CommandPlan` 的局部 apply。

这些不影响 v1 的目标：先证明后端 XML worktree Agent 能完成一次真实时间轴编辑闭环。

## Recommendation

当前阶段推荐按 v1 直接替换路径实施：

```text
start round:
  frontend sends current timeline JSON
  backend creates XML worktree

agent editing:
  backend XML tools only

apply request:
  backend validates XML and compiles targetTimeline

success:
  frontend directly replaces tracks + timelineItems with targetTimeline
```

这个版本牺牲并发编辑正确性，但能最快验证架构价值。等 XML codec、工具、apply command 都稳定后，再把三方合并作为第二阶段加回来。
