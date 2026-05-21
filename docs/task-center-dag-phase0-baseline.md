# Task Center DAG Phase 0 Baseline

本文件固化引入 `JobRuntime` 前的现有行为基线。第 0 阶段只确认边界和验收路径，不改运行路径。

## 当前入口

### `UnifiedMediaModule.startMediaProcessing(mediaItem)`

位置：`src/core/modules/UnifiedMediaModule.ts`

当前职责：

- 为 `mediaItem` 建立自动保存 watcher。
- 通过 `getDataSourceRegistry().getProcessor(mediaItem.source.type)` 获取 processor。
- 调用 `processor.addTask(mediaItem)` 进入现有队列。
- 找不到 processor 时将 `mediaItem` 转为 `error`。

当前调用方：

- 用户导入或粘贴媒体：`src/components/panels/LibraryMediaGrid.vue`
- 项目加载后立即加载被时间轴或当前目录引用的媒体：`src/core/modules/UnifiedProjectModule.ts`
- 打开目录时启动 pending 资产：`src/core/modules/UnifiedDirectoryModule.ts`
- AI 生成、角色生成、agent 命令、时间轴右键 ASR、属性面板重试等 UI 路径。

后续迁移边界：

- 阶段 2 可保留函数名，内部优先 `ensure(media-ready:${mediaItem.id})`。
- fallback 必须保持现有 `processor.addTask(mediaItem)` 路径。

### `UnifiedMediaModule.cancelMediaProcessing(mediaId)`

位置：`src/core/modules/UnifiedMediaModule.ts`

当前职责：

- 通过 `mediaId` 查找 `mediaItem`。
- 根据 `mediaItem.source.type` 查找 processor。
- 调用 `processor.cancelTask(mediaId)`。
- 取消成功后保存项目。

当前限制：

- `UserSelectedFileProcessor.cancelTask()` 固定返回 `false`。
- `AIGenerationProcessor.cancelTask()` 当前未实现抽象方法，属于阶段 0 发现的现状风险。
- `BizyAirProcessor.cancelTask()` 和 `ASRProcessor.cancelTask()` 只允许 `mediaStatus === 'pending'` 时取消。
- `BizyAirProcessor` 的轮询 controller 以 `mediaItem.id` 保存，但取消读取 `taskId`，当前传入同为 `mediaId`，可以命中。
- `ASRProcessor` 的流 controller 以 `asrTaskId` 保存，取消时读取 `asrTaskId`，可以命中。

后续迁移边界：

- 阶段 2 可优先取消 `media-ready:${mediaId}`。
- fallback 必须保持当前 processor cancellation 行为和返回值语义。

### `UnifiedMediaModule.waitForMediaItemReady(mediaItemId)`

位置：`src/core/modules/UnifiedMediaModule.ts`

当前职责：

- 立即检查并监听 `mediaItem.mediaStatus`。
- `ready` 时 resolve `true`。
- `error`、`cancelled`、`missing` 时 reject。
- 其他状态继续等待。

后续迁移边界：

- 阶段 2 可优先等待 `ensure(media-ready:${mediaId})`。
- fallback 必须保持当前基于 Vue `watch` 的状态语义。

## DataSourceRegistry 基线

位置：`src/core/datasource/registry.ts`

默认注册：

| type | processor | 主要用途 |
| --- | --- | --- |
| `user-selected` | `UserSelectedFileProcessor.getInstance()` | 用户导入、项目加载本地媒体 |
| `ai-generation` | `AIGenerationProcessor.getInstance()` | 后端 AI 生成任务恢复、下载、解码 |
| `bizyair` | `BizyAirProcessor.getInstance()` | BizyAir 任务轮询、结果下载、解码 |
| `asr` | `ASRProcessor.getInstance()` | ASR 任务监听、字幕文本创建 |

后续迁移边界：

- `getProcessor(type)` 是阶段 2 fallback 的最小依赖。
- 专用 getter 可以暂时保留给现有 UI 或 resolver 使用。
- `register/unregister/getRegisteredTypes/getAllProcessors` 暂不进入 resolver 必需接口。

## Processor 行为基线

### `DataSourceProcessor`

位置：`src/core/datasource/core/BaseDataSourceProcessor.ts`

当前职责：

- `addTask(mediaItem)` 使用 `mediaItem.id` 作为 task id。
- 通过 `p-limit` 控制并发。
- 保存 `tasks: Map<string, AcquisitionTask>` 供取消和状态查询。
- `executeTaskWithLimit()` 调用子类 `executeTask()`，finally 删除 task。
- `transitionMediaStatus()` 统一调用 `MediaStatusManager.transitionTo()`。

后续 resolver 可复用：

- 阶段 2 可以复用 `addTask(mediaItem)` 包装旧路径。
- 阶段 3 后应逐步拆出文件准备、下载、解码等能力，避免 resolver 继续依赖 processor 队列。

### `UserSelectedFileProcessor`

当前路径：

1. `addTask(mediaItem)`
2. `processMediaItem(mediaItem)`
3. `prepareFileForMediaItem(mediaItem)`
4. `bunnyProcessor.processMedia(mediaItem, file)`
5. 用户创建时 `saveMediaToProject(mediaItem, file)`
6. `mediaStatus -> ready`

状态/数据副作用：

- `source.progress` 成功后为 `100`，失败时为 `0`。
- USER_CREATE 使用 `source.selectedFile` 后会置为 `null`。
- PROJECT_LOAD 通过 `globalMetaFileManager.loadMediaFile(mediaItem.id)` 加载文件。
- 成功设置 `mediaItem.mediaType`、`runtime.bunny`、`duration`。

后续 resolver 可复用：

- 文件验证：`validateFile(file)`。
- 项目文件加载：`globalMetaFileManager.loadMediaFile(mediaItem.id)`。
- 解码：`bunnyProcessor.processMedia(mediaItem, file)`。
- 保存：`globalMetaFileManager.saveMediaToProject(mediaItem, file)`。

后续应废弃或收敛：

- processor 内部队列和 `addTask()`。
- `selectedFile` 清理与文件准备耦合在 processor 私有方法中，拆 DAG 时需要显式资源化。

### `AIGenerationProcessor`

当前路径：

1. USER_CREATE 预保存 meta。
2. 优先检查本地媒体文件是否存在。
3. 本地存在：加载本地文件。
4. `source.resultData` 存在：根据 URL 或 `/api/media/tasks/{taskId}/file` 下载结果。
5. 否则监听 `/api/media/tasks/{aiTaskId}/status` NDJSON 流。
6. 成功后解码、保存媒体、保存 meta、`mediaStatus -> ready`。

状态/数据副作用：

- `source.resultData`、`source.taskStatus`、`source.progress` 持久化或运行时更新。
- 失败时 `source.errorMessage` 写入并保存 meta。
- 成功时系统通知 `AI 生成完成`。

后续 resolver 可复用：

- `handleFinalResult()` 的结果映射思想。
- 远程/本地结果下载路径。
- `mapContentTypeToMediaType()`。
- 失败时保存 meta 的策略。

后续应废弃或收敛：

- processor 自己维护进度流和队列。
- resolver 不应通过 `useUnifiedStore()` 直接做通知；应通过事件或业务层处理。
- `cancelTask()` 未实现，迁移前需要补齐或由 `JobRuntime.cancel()` 接管。

### `BizyAirProcessor`

当前路径：

1. 初始化 `BizyAirConfigManager`。
2. USER_CREATE 预保存 meta。
3. 优先检查本地媒体文件是否存在。
4. 本地存在：加载本地文件。
5. `resultData + SUCCESS`：直接下载结果。
6. 否则通过 `BizyAirAPIClient.pollUntilComplete()` 轮询。
7. 成功后下载、解码、保存媒体、保存 meta、`mediaStatus -> ready`。

状态/数据副作用：

- `source.taskStatus`、`source.progress`、`source.resultData` 更新。
- API key 从 unified store 读取，不持久化。
- 失败或取消状态会保存 meta。
- 成功时系统通知 `BizyAir 生成完成`。

后续 resolver 可复用：

- `BizyAirAPIClient.pollUntilComplete()`。
- `BizyAirAPIClient.getTaskResults()`。
- `BizyAirAPIClient.cancelTask()`。
- `mapBizyAirContentTypeToMediaType()`。
- 本地文件优先恢复策略。

后续应废弃或收敛：

- processor 队列和 controller map。
- resolver 中直接访问 unified store 读取 API key/发送通知的耦合。

### `ASRProcessor`

当前路径：

1. UI 层先导出音频、上传、提交 ASR、创建占位符 timeline item。
2. 创建 `asr` media item 后调用 `startMediaProcessing()`。
3. processor 监听 `/api/media/tasks/{asrTaskId}/status` NDJSON 流，或直接使用已有 `source.resultData`。
4. 设置 media item 为 text ready。
5. `executeTask()` 最后调用 `processASRResult()`：删除占位符，按 utterances 创建文本 timeline items，删除 ASR media item。

状态/数据副作用：

- `source.resultData`、`source.taskStatus`、`source.progress` 更新。
- 成功会修改 timeline、media library、directory 引用。
- 失败或取消状态会保存 meta。

后续 resolver 可复用：

- `submitASRTask(config)`。
- 进度流协议和 `ASRTaskStatus` 映射。
- `splitAllUtterancesToSubtitles()`。

后续应废弃或收敛：

- `processASRResult()` 同时修改 timeline/media/directory，后续应拆成 resource result 到业务模块的映射。
- processor 内部直接 `useUnifiedStore()` 的副作用。

## 当前状态机基线

媒体状态主要流转：

```text
pending -> asyncprocessing -> decoding -> ready
pending/missing -> asyncprocessing -> decoding -> ready
pending/asyncprocessing/decoding -> error
pending -> cancelled
missing -> pending
```

等待语义：

- `ready` 是唯一成功终态。
- `error`、`cancelled`、`missing` 是等待失败终态。

进度语义：

- `DataSourceRuntimeState.progress` 是 datasource 运行时字段，不持久化。
- 用户文件和远程结果下载成功后通常置为 `100`。
- 失败和取消通常置为 `0` 或保留具体 processor 写入状态。

## 手工验收清单

在引入 `JobRuntime` 前，以下路径作为回归基线：

- 用户导入图片：从素材库添加图片，确认 `pending -> asyncprocessing -> decoding -> ready`，可预览，可保存项目。
- 用户导入视频：从素材库添加视频，确认解码 duration/original size 正常，拖入时间轴可播放。
- 用户导入音频：从素材库添加音频，确认 duration 正常，拖入时间轴可播放或出波形相关流程不回退。
- 项目加载已有媒体：打开已有项目，当前时间轴引用和当前目录中的 pending 媒体会自动启动处理；未引用媒体保持延迟加载。
- AI 生成结果下载并解码：提交后端 AI 生成，确认进度流、`resultData` 保存、结果文件下载、解码、保存 meta/media、通知。
- AI 已完成任务恢复：项目重新加载后，本地文件存在时直接加载；本地缺失但 `resultData` 存在时重新下载并保存。
- BizyAir 已完成任务恢复：本地文件存在时直接加载；本地缺失但 `resultData + SUCCESS` 存在时重新下载并保存。
- BizyAir 进行中任务恢复：有 `bizyairTaskId` 且非失败/取消时继续轮询。
- ASR 生成字幕：右键时间轴 item 发起 ASR，确认音频导出、上传、任务提交、占位符创建、字幕文本 item 创建、ASR media item 清理。
- 处理中取消：在支持取消的远程任务 pending 阶段触发取消，确认远端取消、mediaStatus 为 `cancelled`、meta 保存。
- 失败展示：断网、无 API key、远端失败或文件缺失时，确认 `mediaStatus -> error/missing`，`source.errorMessage` 可被 UI 展示。
- 重试入口：属性面板或素材库重试会重新设置远程 task id / 清空 resultData 后再次 `startMediaProcessing()`。

## 阶段 1/2 前置风险

- `AIGenerationProcessor` 继承抽象类但没有 `cancelTask()` 实现；如果当前类型检查覆盖到该文件，应先补齐现状兼容实现。
- `DataSourceProcessor.addTask()` 不做同一 `mediaItem.id` 去重，重复调用会覆盖 `tasks` map 并再次进入 `p-limit`；阶段 2 的 `JobRuntime.ensure()` 必须承担去重。
- `ASRProcessor.processASRResult()` 成功后会删除 ASR media item，不能直接按普通 `media-ready` 任务展示和重试，需要单独设计 `asr-subtitles` 投影。
- 多个 processor 私有方法已经包含 resolver 未来需要的能力；阶段 2 可短期包装，阶段 3 后要把文件准备、远程完成、下载、解码拆成可复用 resolver/helper。
- 当前日志前缀不符合 DAG 统一日志要求；第 0 阶段不改日志，第 1 阶段新增 `JobLogger` 后再统一新路径日志。
