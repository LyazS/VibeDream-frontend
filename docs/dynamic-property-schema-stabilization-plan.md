# 动态属性 Schema 稳定抽象收口状态

## 当前状态

动态属性主链路已经落地：

`PropertySchemaResolver -> PropertyPlanner -> ChangePlan -> ApplyChangePlanCommand -> AnimationRegistry / render state`

当前唯一动态属性域是 filter 参数：

```text
filter.param.<parameterKey>
```

resolver / provider 已经可以基于当前 timeline item 的 filter package metadata 生成动态 schema。`filter.param.*` 已作为第一条动态 schema 路径接入 direct commit、deferred overlay、keyframe 和属性面板渲染。

## 本轮收口目标

- 固化 `filter.param.*` 的 property id 创建、识别和解析规则。
- 让 `PropertyPlanner` 只消费 schema contract，不再为具体 property id 持有业务 normalize 分支。
- 将动态 filter 参数的 schema 解释逻辑从 Vue 组件后移到 view model helper。
- 保持 `filter.param.*` 是当前唯一动态 domain，不扩展 transition / text / mask。

## 稳定边界

- 动态属性集合可以由 provider 生成。
- 执行协议仍由统一 `PropertyPlanner` 和 `ChangePlan` 负责。
- 动态参数不以 `filter.params` 黑盒形式提交。
- 不新增 ChangePlan operation 类型。
- 不改变 filter package manifest 的参数 key 规则。

## 后续方向

下一阶段应继续围绕 `filter.param.*` 打磨 schema contract，而不是新增 provider。只有 filter 动态参数路径在 UI、history、animation 和 render state 中稳定后，才考虑把同一套 provider/resolver 模式复用到其他 domain。
