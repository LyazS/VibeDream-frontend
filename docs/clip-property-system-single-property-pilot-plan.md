# LightCut Frontend 片段属性系统重构实施方案（单属性试点版）

## 1. 文档目的

这份文档不是对现有重构方案做补充，而是重新定义一条更稳的实施路径：

- 不先铺完整通用骨架
- 不先横向迁移一批属性
- 不先同时处理 direct commit、defer、preview、render overlay 等多条链路

本方案主张：

先选一个最小但真实的属性 `transform.rotation`，把它作为唯一试点，补完整条链路；只有当这个单属性已经在新体系里形成闭环，才允许扩展到 `transform` 其他属性组，再扩展到其他属性域。

一句话概括：

**先把一个属性做完整，再把这一个属性的成功路径复制出去。**

## 2. 为什么要改成单属性试点

当前属性系统的核心问题，不只是代码分散，而是多个职责层同时在决定“一个属性到底该怎么写”：

- UI / composable 在决定写哪里
- history 入口在决定走哪种命令
- command 层有时做代理，有时直接改模型
- defer 为了预览直接污染持久模型
- render 读取链路同时容忍多种中间状态

如果一开始就设计完整骨架，很容易出现两个问题：

1. 抽象先行，但没有经过真实属性验证
2. 看起来很通用，但一旦碰到关键帧、撤销、预览、渲染一致性，就又要回头改抽象

因此，这次实施不以“先把架子搭全”为目标，而以“先解决一个真实属性的全链路问题”为目标。

## 3. 核心原则

### 3.1 只允许一个真实试点属性

第一轮只允许 `transform.rotation` 进入新体系。

这里的“只允许”不是泛泛而谈，而是明确约束：

- 不同时迁移 `transform.position`
- 不同时迁移 `transform.size`
- 不同时迁移 `opacity`
- 不同时迁移 `audio` / `filter` / `mask` / `text`

### 3.2 单属性必须走完整链路

`transform.rotation` 不是只验证提交成功，而是要逐步覆盖：

- 属性面板输入
- 统一属性提交入口
- mutation planning
- history command
- undo / redo
- render 读取
- defer / preview overlay
- 旧路径删除
- 回归测试

如果只完成 direct commit 就开始复制到其他属性，最后会把不完整路径成批扩散出去。

### 3.3 阶段推进按“纵向补完”而不是“横向铺开”

实施顺序不是：

- 先做一个最小试点
- 然后立刻抽象成通用骨架
- 然后开始接更多属性

而应该是：

- 先做 `transform.rotation` 的 direct commit
- 再继续补完 `transform.rotation` 的 defer / preview / render overlay
- 再删掉 `transform.rotation` 的旧路径
- 再以 `transform.rotation` 为模板复制到相邻属性组

### 3.4 抽象必须从真实成功路径中长出来

任何 registry、schema、mutation service、render resolver、session 设计，都必须先服务于 `transform.rotation` 真实闭环，而不是先追求抽象完整度。

标准不是“类型设计看起来很优雅”，而是：

- 这个抽象是否真的让 `transform.rotation` 更稳定
- 这个抽象是否能原样复制到第二个属性或属性组
- 这个抽象是否减少旧系统中的职责混杂

## 4. 试点属性定义

首个唯一试点属性：

- `transform.rotation`

选择它的原因：

- 它是真实高频属性
- 它在现有动画模型中是单字段组，语义边界清晰
- 它同时覆盖无关键帧和有关键帧两类行为
- 它最终一定会碰到 direct commit、defer、render 一致性问题
- 它足够小，不会把首轮工作推成大爆炸重构
- 它不会像 `transform.position` 一样拆开 `x/y` 的组语义，也不会像 `transform.size` 一样牵扯等比缩放和尺寸联动

它不是“示例属性”，而是“样板属性”。

这意味着后续所有复制都要以它为参照：

- 接口命名是否合理
- schema 粒度是否合适
- operation 形态是否稳定
- command 边界是否清晰
- render-state 是否能承接交互态

## 5. 实施总策略

总策略分两层：

### 5.1 第一层：封住扩散

先阻止属性区继续制造新的分散入口。

目标不是立刻把所有旧逻辑删掉，而是先做到：

- `transform.rotation` 作为唯一试点属性，后续只围绕它接入新架构
- 非试点属性入口可以继续保留旧实现，也可以显式冻结，但不得伪装成“已进入新架构迁移”
- 属性区用户操作不再新增新的直写路径，尤其不能在 UI 层继续扩散新的提交分流逻辑

### 5.2 第二层：围绕 `transform.rotation` 做全链路闭环

围绕一个属性逐步推进：

1. direct commit 跑通
2. history/undo/redo 稳定
3. render 读取明确
4. defer / preview 不再污染持久模型
5. 旧 `transform.rotation` 路径删除
6. 回归测试形成模板

只有在这 6 件事都完成后，才进入横向复制。

## 6. 阶段规划

### 阶段 0：冻结 UI 扩散入口

目标：

- 防止属性区继续扩散旧提交路径
- 明确 `transform.rotation` 是唯一试点属性
- 对暂不迁移的属性入口采取“保留旧实现”或“显式冻结”策略，避免误接到半成品新链路

这一阶段只处理“试点范围划定”和“入口冻结策略”，不处理“底层全部重写”。

完成标准：

- 文档和实现层都明确：首轮只有 `transform.rotation` 进入新架构试点
- `transform.rotation` 的用户可达 UI 入口已经从“继续承接旧链路改造”切换为“等待新架构接入”
- 非试点属性若暂不处理，可以保留旧实现；若担心继续扩散，可以在 UI 层显式冻结
- 被冻结的入口必须被视为“暂不可用”，而不是“已经完成迁移”
- 新增属性功能不得引入新的直写 `config` 路径或新的 UI 层提交分流

不包含：

- 不要求 agent / 脚本路径一起治理
- 不要求本阶段删除所有旧命令
- 不要求本阶段解决 defer
- 不要求本阶段把所有属性入口统一接到一个新提交接口

### 阶段 1：`transform.rotation` direct commit 最小闭环

目标：

- 只让 `transform.rotation` 的 direct commit 在新路径上跑通

链路范围：

`属性面板旋转角度输入 -> 统一属性入口 -> PropertyMutationService -> ChangePlan -> ApplyChangePlanCommand -> 持久状态生效 -> 当前渲染结果正确`

本阶段只解决最小主链路。

完成标准：

- `transform.rotation` 数字输入修改可正确生效
- 无关键帧场景行为正确
- 有关键帧场景行为正确
- undo / redo 正常
- 属性区入口不再自行判断写 `config` 还是 `animation`

明确不做：

- 不做 `transform.position`
- 不做 `transform.size`
- 不做 slider dragging
- 不做 defer
- 不做 preview overlay
- 不做 runtime deferred 结构完整设计
- 不做通用批量属性修改

### 阶段 2：补完 `transform.rotation` 的渲染态与交互态链路

目标：

- 继续只盯 `transform.rotation`
- 把它从“可提交”补完到“可交互、可预览、可渲染一致”

这一阶段要解决的是之前旧系统里最容易污染模型的部分。

范围：

- `transform.rotation` 的 defer
- `transform.rotation` 的 preview overlay
- `transform.rotation` 的 render-state 读取收敛
- `transform.rotation` 交互态和 commit 态的一致性

完成标准：

- `transform.rotation` 的 defer 不再直接改持久模型
- 预览渲染通过正式的 transient overlay / render-state 通路生效
- commit 后结果与预览一致
- 回滚 defer 时不依赖旧的“污染后恢复”逻辑

明确不做：

- 不同时迁移 `filter` defer
- 不同时迁移 `mask` defer
- 不同时建立通用于所有属性的 interaction session 体系

### 阶段 3：把 `transform.rotation` 收敛成可复制样板

目标：

- 不是扩属性，而是先把 `transform.rotation` 相关抽象定型

这一阶段做的事情是从成功样板里反推出稳定抽象，包括但不限于：

- property schema 最小稳定字段集
- mutation service 的稳定输入输出
- change plan / change operation 的稳定形态
- render-state 中 overlay 的最小承载方式
- `transform.rotation` 旧路径删除策略
- 测试模板沉淀

完成标准：

- `transform.rotation` 不再依赖旧提交主路径
- `transform.rotation` 的 direct commit 和 defer 都已跑在新体系
- 新抽象已经足够支持复制到第二个属性或属性组
- 此时再看 registry / resolver / session 的设计，已经是从真实路径长出来的，而不是空转抽象

### 阶段 4：复制到 `transform` 家族其他属性

目标：

- 只扩到 `transform` 邻近属性

优先顺序建议：

1. `transform.opacity`
2. `transform.position`，作为一组同时覆盖 `x/y`（已先行完成组级验证）
3. `transform.size`，作为一组同时覆盖 `width/height`（实施中）
4. `transform.geometry`，在 `position` 和 `size` 都稳定后收敛 `x/y/width/height` 的联动入口

原因：

- 这些属性或属性组与 `transform.rotation` 在 transform 域内最接近
- 复制时最容易暴露抽象是否真的稳定
- 如果连同域复制都困难，说明样板仍未成熟，不应扩到其他域
- `transform.position` 不能再拆成单独 `x` 或 `y` 做迁移；它在现有动画模型中就是 `x/y` 组
- `transform.size` 不能再拆成单独 `width` 或 `height` 做迁移；它在现有动画模型中就是 `width/height` 组

`transform.position` 组级验证要求：

- UI 可以由 X 或 Y 单字段输入触发
- mutation intent 可以是 `{ x }` 或 `{ y }` patch
- 规划到 animation keyframe 时必须生成完整 `{ x, y }` value / properties
- 无关键帧时允许只 patch 静态 `config.x` / `config.y`
- 当前帧在 position keyframe 上时，必须 merge 当前 keyframe value 后更新完整组值
- 当前帧在两个 position keyframe 之间时，必须基于当前插值值创建完整组值
- position keyframe toggle 必须创建 / 删除 `transform.position` 组关键帧，而不是独立 `x` / `y` 关键帧

`transform.position` 阶段 4 子项完成状态：

- X/Y 数字输入已接入 `PropertyMutationService.plan()` 的 `transform.position` direct intent
- direct intent 支持 `{ x }`、`{ y }` 单字段 patch，并在 animation 写入时补齐完整 `{ x, y }` 组值
- 无关键帧时写入静态 `config.x` / `config.y`
- 当前帧命中 position keyframe 时，更新目标 keyframe 的完整 `{ x, y }` value / properties
- 当前帧位于两个 position keyframe 之间时，基于当前插值值创建完整 `transform.position` 组关键帧
- position keyframe toggle 已通过 `ChangePlan` 创建 / 删除 `transform.position` 组关键帧
- 用户已手动验证 position direct input、position keyframe toggle、组级 `{ x, y }` 写入、undo / redo 没有问题
- 已回归 `transform.rotation` 的 direct input、slider commit、keyframe toggle、undo / redo，未发现 position 复制影响 rotation 样板路径

暂不纳入本子项完成范围：

- 对齐按钮 `alignHorizontal` / `alignVertical` 仍属于 position 派生操作，尚未接入新架构
- position 没有 transient overlay / defer preview，本子项只验证 X/Y direct input 和 keyframe toggle
- `transform.size`、`transform.opacity` 尚未作为阶段 4 子项完成迁移

`transform.size` 组级验证要求：

- UI 可以由 width 或 height 单字段输入触发
- mutation intent 可以是 `{ width }` 或 `{ height }` patch
- 比例锁开启时，UI/composable 可以把单字段输入扩成 `{ width, height }` patch，但写入策略仍由 `PropertyMutationService.plan()` 决定
- 规划到 animation keyframe 时必须生成完整 `{ width, height }` value / properties
- 无关键帧时允许只 patch 静态 `config.width` / `config.height`
- 当前帧在 size keyframe 上时，必须 merge 当前 keyframe value 后更新完整组值
- 当前帧在两个 size keyframe 之间时，必须基于当前插值值创建完整组值
- size keyframe toggle 必须创建 / 删除 `transform.size` 组关键帧，而不是独立 `width` / `height` 关键帧

`transform.size` 阶段 4 子项实施状态：

- width/height 数字输入已接入 `PropertyMutationService.plan()` 的 `transform.size` direct intent
- fit/fill 预设按钮已通过 `setSizeDirectly()` 进入 `transform.size` direct intent
- size keyframe toggle 已通过 `ChangePlan` 创建 / 删除 `transform.size` 组关键帧
- 比例锁开关已通过 `visual-config-patch` 写入 `config.proportionalScale`，用于支持 size 单字段测试
- 开启比例锁时，会按当前 width 和原始宽高比生成一次 `transform.size` direct intent，同一个 `ChangePlan` 内完成开关与 height 同步
- 比例锁开关不是 animation group，本阶段不把 `proportionalScale` 纳入关键帧组
- size 没有 transient overlay / defer preview，本子项只验证 width/height direct input、fit/fill direct commit 和 keyframe toggle

`runtime.renderConfig` 收敛状态：

- `ApplyChangePlanCommand` 不再手动 patch `runtime.renderConfig`
- command 执行真实写入后，统一调用 `applyAnimationToConfig(item, frame)` 从 `config + animation + frame` 派生当前 renderConfig
- command undo 恢复 snapshot 后，同样调用 `applyAnimationToConfig(item, frame)` 刷新 renderConfig
- `applyKeyframeSnapshot()` 只恢复真实状态 `config` / `animation` / `filterEffect`，不再直接写视觉 renderConfig
- 当前阶段仍保留 `runtime.renderConfig` 作为运行时缓存，但它的刷新入口开始收敛到 animation resolver

完成标准：

- `transform` 家族相邻属性能低风险复制
- 复制过程中不需要重写核心抽象
- 旧 `transform` 专用分流逻辑开始整体收缩

### 阶段 5：扩到其他属性域

目标：

- 在 `transform` 家族验证稳定后，再扩到其他域

建议顺序：

1. `audio`
2. `filter`
3. `mask`
4. `text`

这里不要求完全按这个顺序执行，但要求遵守一个原则：

**先从最接近现有样板的属性开始，不要同时开多个复杂域。**

完成标准：

- 其他属性域接入统一 mutation 入口
- 历史分流逻辑不再按老属性类型硬编码
- 新接入属性默认遵循试点样板，而不是重新各自设计路径

### 阶段 6：删除旧系统主路径

目标：

- 在新体系已覆盖主用属性后，删除旧入口和旧命令体系

包含内容：

- 删除属性区中残留的直写 `config` 路径
- 删除旧属性分流逻辑
- 删除旧 defer 污染模型路径
- 删除已被替代的专用命令

完成标准：

- UI / composable 不再直接修改持久属性
- 属性系统的主路径只有统一入口
- 旧系统不再占据主执行路径

## 7. 第一阶段和第二阶段的边界

为了避免实施过程中再次失焦，需要明确区分两个最容易混淆的阶段。

### 阶段 1 只回答一个问题

**`transform.rotation` 的 direct commit 能否用新路径稳定跑通？**

如果这个问题还没回答清楚，就不要开始：

- 通用 registry 设计
- 完整 deferred mode 设计
- 通用 interaction session 分层
- 全量 render resolver 统一化

### 阶段 2 才回答第二个问题

**`transform.rotation` 的交互预览和最终提交，能否在不污染持久模型的情况下保持一致？**

只有这个问题回答完，`transform.rotation` 才算真正成为完整样板。

## 8. 最小抽象原则

新体系会引入一些必要对象，但每个对象都必须坚持“最小可用”原则。

### 8.1 Property Schema

第一版只需要服务于 `transform.rotation`。

要求：

- 路径可识别
- 能表达 direct commit 的目标属性和值
- 能表达关键帧相关写入策略

不要求：

- 一次定义所有 storage kind
- 一次定义所有 deferred mode
- 一次定义所有属性能力矩阵

### 8.2 PropertyMutationService

第一版只要能稳定把 `transform.rotation` intent 规划成可执行 plan。

要求：

- 输入是统一 intent
- 输出是标准化 plan
- 规划阶段负责属性语义判断

不要求：

- 一次支持所有属性
- 一次支持所有 batch 场景
- 一次支持 AI / script / preview 全来源

### 8.3 ApplyChangePlanCommand

第一版只需要支持 `transform.rotation` 真实 operation。

要求：

- 可执行
- 可撤销
- 可重做

不要求：

- 一次承接未来所有 operation 变体

### 8.4 Render-State / Overlay

render-state 的设计也必须遵守同样规则。

第一步不是统一全项目所有渲染态，而是让 `transform.rotation` 在交互态与提交态之间有正式通路。

## 8.5 `transform.rotation` 阶段 3 样板快照

当前 `transform.rotation` 的可复制样板由以下最小结构组成：

- Property Schema：`transformRotationSchema`
  - `propertyId: 'transform.rotation'`
  - `animationGroupId: 'transform.rotation'`
  - `valueField: 'rotation'`
  - 能力开关只声明 direct commit、keyframe toggle、transient overlay
- PropertyMutationService：统一 `plan(intent)` 入口
  - `kind: 'direct'` 由规划阶段判断当前 animation 状态，并规划成 `static-config-patch` / `animation-keyframe-update` / `animation-keyframe-create`
  - `kind: 'keyframe-toggle'` 由规划阶段判断当前帧是否已有关键帧，并规划成 `animation-keyframe-create` / `animation-keyframe-delete`
  - 规划阶段负责 rotation 数值归一化、属性能力判断和持久写入策略选择
- ApplyChangePlanCommand：只执行真实 operation
  - `static-config-patch` 直接写 `item.config`
  - `animation-keyframe-update` 直接更新目标 keyframe
  - `animation-keyframe-create` 直接创建目标 keyframe
  - `animation-keyframe-delete` 直接删除目标 keyframe
  - 命令持有执行前 snapshot，负责 undo / redo
- Render-State / Overlay：`rotationOverlay`
  - slider input 只写 transient overlay
  - `TimelineItemQueries.getRenderConfig()` 叠加 overlay
  - slider commit / direct commit 先清 overlay，再提交 plan

旧路径删除策略：

- `transform.rotation` 的数字输入、slider commit、keyframe toggle 不再调用旧 `updateGroupDirect` / `applyDeferredPatch` / 通用 `toggleKeyframeWithHistory`
- `transform.rotation` 的 direct commit / keyframe toggle 不再调用旧 `setGroupValue` / `toggleGroupKeyframe` 做隐式分流
- 非 `transform.rotation` 的属性仍然冻结或保留旧实现，不能误标为已迁移
- 后续复制到第二个属性时，只允许复制上述 schema -> intent -> plan -> command -> overlay 的闭环，不复制旧 composable 内部分流

阶段 3 验收状态：

- `transform.rotation` direct commit 已跑在新体系
- `transform.rotation` slider preview 已通过 transient overlay 生效
- `transform.rotation` keyframe toggle 已通过 `ChangePlan` 生效
- `transform.rotation` 用户可达主路径不再依赖旧提交主路径

## 9. 风险判断

最大风险不是类型定义不够通用，而是阶段节奏失控。

具体表现通常有三类：

1. `transform.rotation` 还没补完整，就开始复制到多个属性或属性组
2. direct commit 刚跑通，就提前设计完整通用骨架
3. defer 还没理清，就开始抽象整个 interaction session 体系

这些都会导致“试点还没形成样板，扩散已经开始”。

## 10. 验证要求

验证必须围绕 `transform.rotation` 单属性展开，而不是泛泛做通用测试。

第一批必须覆盖的场景：

- `transform.rotation` 无关键帧时直接修改
- `transform.rotation` 有关键帧时直接修改
- `transform.rotation` 不允许编辑时被正确拦截
- `transform.rotation` undo / redo 正常
- `transform.rotation` defer 预览不污染持久模型
- `transform.rotation` defer 提交结果与预览一致
- `transform.rotation` 输入值按现有角度归一化规则处理

验证分层建议：

- 单元测试：schema、mutation planning、change plan 生成
- 集成测试：history command、关键帧行为、undo / redo
- 交互回归：属性面板输入、拖动预览、提交后渲染一致性

## 11. 最终实施顺序

推荐严格按下面顺序推进：

1. 冻结属性区扩散入口
2. 做 `transform.rotation` direct commit 最小闭环
3. 补完 `transform.rotation` 的 defer / preview / render-state
4. 删除 `transform.rotation` 旧主路径并沉淀样板抽象
5. 复制到 `transform` 其他属性
6. 再扩到 `audio` / `filter` / `mask` / `text`
7. 最后删除旧系统主路径

这个顺序的关键，不是保守，而是避免再次做出一套“看起来通用、实际上没有通过真实属性闭环验证”的新架构。

## 12. 决策准则

后续实施过程中，遇到是否扩抽象、是否扩属性、是否迁移新域的判断时，统一用下面三条做决策：

1. `transform.rotation` 是否已经完整跑通，而不只是 direct commit 跑通
2. `transform.rotation` 的新路径是否已经能替代旧主路径，而不再依赖旧逻辑兜底
3. 第二个属性接入时，是否只是复制样板，而不是反过来重写样板

只要这三条里有一条答不上来，就不应该继续横向扩展。
