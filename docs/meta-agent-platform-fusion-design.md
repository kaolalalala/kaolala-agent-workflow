# Meta-Agent 与平台深度融合设计方案

## 1. 目标

这份方案聚焦一个问题：

当前 `Meta-Agent` 已经在后端形成了一套相对完整的运行体系，包括：

- session / step / iteration
- todo-driven runtime
- wave / parallel execution
- control plane summary
- checkpoints / replay candidates
- recovery / routing / memory writeback
- artifact / workspace side effects

但这些能力目前主要停留在：

- `Meta-Agent` 独立页面中的专属视图
- 后端 session 级结构化对象
- 与平台其它模块相对松散的跳转关系

而平台本身已经有另一套成熟能力：

- `运行中心` 的列表、分析、详情、对比
- `Workflow` 的 graph/canvas/task tree/runtime snapshot
- `Evaluation` 的 replay / compare / report
- `Project` 维度的统一入口

所以接下来更有价值的方向，不是再给 `Meta-Agent` 单独补更多局部面板，而是把它变成平台里的一级运行对象，并与现有运行中心、项目空间、workflow 视图、评测链路深度融合。

本方案希望解决的核心问题是：

1. `Meta-Agent` 是否应该成为运行中心中的一级 run 类型。
2. `Meta-Agent` 的 `step / todo / wave / delegation / recovery` 是否可以像 workflow 一样被图形化展示。
3. `Meta-Agent` 和它派生出来的 workflow/dev/tool/browser 执行，如何形成统一的“父子运行图谱”。
4. 如何在不破坏现有基础平台能力的前提下，增量接入。

---

## 2. 结论先行

### 2.1 总体结论

这个方向 **整体可行性高**，而且值得做。

原因不是“体验会更好看”，而是：

- `Meta-Agent` 已经不只是一个独立 demo 页面，而是平台里的上层 controller。
- 它产生了真实的运行对象、控制对象、恢复对象和产物对象。
- 如果这些对象长期停留在独立页里，平台会形成两套运行世界：
  - 一套是 workflow / run center 世界
  - 一套是 meta-agent session 世界
- 两套世界并行发展，后续一定会带来：
  - 诊断链路割裂
  - 指标口径不统一
  - run lineage 难以追踪
  - 用户心智分裂

### 2.2 推荐原则

推荐采用：

- **统一运行目录**
- **分层可视化**
- **投影视图而非强行同构**
- **先只读融合，后控制融合**

一句话就是：

> 不要把 Meta-Agent 硬塞成普通 workflow，也不要继续让它完全游离于平台之外。  
> 最合理的做法，是把 Meta-Agent 作为“上层监督运行”，并把它投影到运行中心和 workflow-style graph 视图里。

---

## 3. 当前现状分析

### 3.1 Meta-Agent 已具备的平台级数据

从当前实现看，`Meta-Agent` 已经具备这些前端可消费对象：

- `session`
- `result`
- `supervisorRunState`
- `controlPlaneSummary`
- `checkpoints`
- `replayCandidates`
- `planningContextSummary`
- `memoryWritebackSummary`

其中 `supervisorRunState` 下面又已经有：

- `todos`
- `wave_history`
- `execution_log`
- `issues`
- `artifacts`
- `workspace_files`

这意味着做融合时，并不需要先重新发明运行语义，很多核心对象已经存在。

### 3.2 平台已有的可复用能力

平台现有可直接复用的能力主要有三类：

#### A. 运行中心能力

- run list
- analytics
- run detail
- diagnostics
- replay / compare

这套能力已经是一条成熟链路，只是当前 run type 主要围绕 workflow/dev。

#### B. Workflow 图形化能力

- ReactFlow 画布
- node / edge 视觉语言
- runtime status 展示
- task tree / bottom panel / inspector

说明平台已经有图形化执行视图的基础设施。

#### C. 项目级容器能力

- project 入口
- project 内 runs/workflows/assets/evaluations
- 统一导航结构

这使得 `Meta-Agent` 完全可以从“孤立页面”升级为“项目内一级运行能力”。

### 3.3 当前割裂点

目前的割裂点主要有五个：

1. `Meta-Agent` 运行没有进入运行中心的统一 run 目录。
2. `Meta-Agent session` 和底层 `workflow run / dev run / tool execution` 没有形成显式 lineage。
3. `todo / wave / delegation / recovery` 还没变成图形化执行对象。
4. `Meta-Agent` 的 checkpoints / replay candidates 没接入平台统一 replay 体系。
5. 观测层重复建设：
   - meta-agent 页面有一套 runtime panels
   - run detail 有另一套 traces / timeline / control-plane

如果不处理，后面只会越来越重。

---

## 4. 融合目标

### 4.1 一级目标

#### 目标 1：把 Meta-Agent 纳入运行中心

用户在运行中心里应该能看到：

- workflow run
- dev run
- meta-agent run

并支持：

- 统一筛选
- 统一排序
- 统一项目归属
- 统一状态统计
- 单独 scope 切换

#### 目标 2：把 Meta-Agent 运行过程图形化

至少要支持三种图形化视角：

1. `Todo Dependency Graph`
2. `Wave / Parallel Execution Graph`
3. `Step Playback Graph`

#### 目标 3：建立父子运行谱系

一个 meta-agent session 应该能直接看到：

- 它自己这次 planning / review / recovery 的过程
- 它触发的 workflow runs
- 它触发的 dev/tool/browser/operator executions
- 每个下游执行对象与哪个 todo / step / wave 相关

#### 目标 4：把 replay / compare 统一起来

Meta-Agent 的 replay 不应只是 session 页面上的局部功能，而应能进入平台统一 replay 对比体系。

### 4.2 二级目标

- 让项目页能看到“最近 Meta-Agent 运行”
- 让评测页未来能对 Meta-Agent session 做 case replay / compare
- 让 artifacts / workspace outputs 可从多个页面被复用
- 让用户在 workflow 视角和 meta-agent 视角之间自由切换

---

## 5. 融合方式判断：什么该复用，什么不该硬复用

这是方案里最关键的判断之一。

### 5.1 应该复用的部分

应该尽量复用：

- 运行中心的列表、过滤、analytics 外壳
- run detail 的“详情页思维”
- workflow 的 graph rendering 基础能力
- 统一的 artifacts / replay / compare 入口
- 项目级导航与链接关系

### 5.2 不应该硬复用的部分

不建议直接把 `Meta-Agent todo graph` 当成现有 workflow 编辑器里的真实 workflow definition。

原因有三点：

1. 语义不同  
   workflow definition 是用户配置的静态图；meta-agent todo graph 是运行时生成的动态图。

2. 生命周期不同  
   workflow graph 是可编辑、可版本化、可发布的；meta-agent todo graph 是 session-bound、step-bound、可变化的。

3. 状态变化速度不同  
   todo graph 在执行中可能 replan、split、reroute、prune、insert；如果直接塞进编辑器 store，会引入大量不适配。

### 5.3 推荐做法

推荐做法是：

> 复用 graph rendering 和视觉语言，但不要复用 workflow editor 的编辑语义与 store。

也就是说：

- 可以复用 ReactFlow、节点样式、布局逻辑、状态色
- 但应新建 `MetaAgentExecutionGraph` 这一层投影，而不是直接接 `useWorkflowStore`

这是“深度融合但不互相污染”的关键。

---

## 6. 目标产品形态

## 6.1 运行中心新增 Meta-Agent 视角

运行中心顶部 scope 从现在的：

- `workflow_run`
- `dev_run`

扩展为：

- `workflow_run`
- `dev_run`
- `meta_agent_run`
- 可选：`all_runs`

### 在列表里新增字段

每条 meta-agent run 建议展示：

- session id
- goal
- project id
- status
- current phase
- current step
- todo progress
- open issues
- llm calls / tokens
- child run count
- startedAt / duration

### 在 analytics 中新增指标

- total meta-agent runs
- success / failed / terminated / max_steps
- avg steps
- avg todos
- avg recovery count
- avg reroute / retry count
- avg child run count
- token usage
- phase distribution

### 可行性判断

高。

原因：

- 现有运行中心已经是 scope 驱动。
- meta-agent 也已经有 session list 和 summary。
- 主要工作不是 UI 重写，而是统一 adapter/view model。

---

## 6.2 Meta-Agent 专属详情页升级为“运行详情页”

当前 `Meta-Agent` 页更像：

- 启动入口
- session dashboard
- 独立 runtime page

建议把它逐步拆成两层：

### A. Meta-Agent Launchpad

保留现在的：

- goal 输入
- project 选择
- max planning rounds
- max step limit
- threshold
- bandit / training controls

这个页面偏“启动器 + 控制台入口”。

### B. Meta-Agent Run Detail

新增独立 run detail route，例如：

- `/meta-agent/runs/[sessionId]`

或者项目内：

- `/projects/[projectId]/meta-agent/[sessionId]`

这个页面承接：

- Mission Control
- Control Plane
- Control Trajectory
- Todo Graph
- Wave Graph
- Checkpoints / Replay
- Child Runs
- Recovery / Routing
- Trace / Step Playback

### 可行性判断

高。

原因：

- 当前 meta-agent 页面已经具备绝大多数 detail 面板。
- 只是缺少路由分层和列表/detail 分离。

---

## 6.3 Workflow 化展示：Meta-Agent 的三种图

这里是最重要的前端设计部分。

### 图 1：Todo Dependency Graph

这是最接近 workflow 的图。

#### 节点

节点代表一个 `todo`：

- title
- capability type
- assignee
- status
- review result
- retry/reroute count
- forced target
- current owner badge

#### 边

边来自：

- `depends_on`

可额外标注：

- normal dependency
- inserted by replan
- split-from relation

#### 分组

节点可按以下维度切换分组显示：

- capability type
- assignee
- wave
- status

#### 作用

这个图回答的问题是：

- 计划原本长什么样
- 当前 todo 结构是什么
- 哪些任务可并行
- 哪些任务被 reroute / split / prune

#### 可行性判断

很高。

因为当前 `todos + depends_on + status + assignee + review_result` 已经齐全。

### 图 2：Wave / Parallel Execution Graph

这不是静态依赖图，而是执行视图。

#### 核心表达

每个 `wave` 是一个执行容器。

图中可以这样呈现：

- 左到右是 wave 顺序
- 每个 wave 里是一组并行 todo
- wave 内每个 todo 显示 mode：
  - self
  - delegate
  - split
- wave 与 wave 之间通过 completion / review / recovery 过渡

#### 这个图回答的问题

- 哪些 todo 真正并行执行了
- 哪些任务在同一波里完成/失败
- 某个 wave 里是否发生了 recovery downgrade
- 并行策略是否有效

#### 可行性判断

高。

因为当前已经有：

- `wave_history`
- `execution_mode_per_todo`
- `review_outcome_per_todo`
- `result_summary_per_todo`

### 图 3：Step Playback Graph

这是一种回放模式，而不是静态图。

#### 核心机制

基于 `checkpoints`：

- 用户拖动 step slider
- 图上只显示该 step 时刻的 todo 状态
- 右侧联动显示：
  - owner
  - current todo
  - current wave
  - issues
  - outputs
  - replay candidates

#### 这个图回答的问题

- 系统是怎么一步步演化到当前状态的
- 哪一步 owner 发生 handoff
- 哪一步出现 recovery / reroute
- 哪一步开始有副作用输出

#### 可行性判断

中高。

因为已有 checkpoints，但想做到足够顺滑，需要补一个“graph snapshot adapter”。

---

## 7. 统一运行模型设计

为了真正接入平台，不建议继续让 `Meta-Agent session` 和 `RunRecord` 完全平行。

建议引入一个上层统一模型：

## 7.1 Unified Execution Record

```ts
type ExecutionRecordType =
  | "workflow_run"
  | "dev_run"
  | "meta_agent_run"
  | "browser_run"
  | "tool_batch_run";

interface UnifiedExecutionRecord {
  id: string;
  type: ExecutionRecordType;
  projectId?: string;
  title: string;
  summary?: string;
  status: string;
  startedAt: string;
  finishedAt?: string;
  durationMs?: number;
  parentExecutionId?: string;
  rootExecutionId?: string;
  sourceTodoId?: string;
  sourceWaveId?: string;
  sourceStep?: number;
  metrics?: {
    steps?: number;
    todos?: number;
    llmCalls?: number;
    totalTokens?: number;
    issues?: number;
  };
}
```

核心思想不是替换现有 run 表，而是建立统一目录层。

### 7.2 Parent / Child Lineage

建议显式支持：

- 一个 `meta_agent_run` 可以派生多个 child execution
- child execution 可以是：
  - workflow run
  - dev run
  - browser operator run
  - tool batch run

这样在详情页里就能回答：

- 这个 todo 具体触发了哪个底层 run
- 某个失败是出在 meta-agent 自己，还是出在 child run
- 某个输出文件来自哪个 todo / 哪个 child execution

### 7.3 可行性判断

中高。

因为从数据语义上完全合理，但需要补 lineage persistence 或统一 adapter 汇总。

建议第一阶段先用 adapter 聚合，不马上改底层所有 persistence schema。

---

## 8. 前端架构设计

## 8.1 不要直接复用 Workflow Editor Store

建议新增一套只读执行图视图层：

```ts
MetaAgentExecutionGraphView
MetaAgentExecutionNodeView
MetaAgentExecutionEdgeView
MetaAgentPlaybackFrameView
```

用途是：

- 接收 meta-agent session 投影
- 只用于展示
- 不承担编辑/发布/草稿语义

### 原因

如果直接把动态 todo graph 接进现有 workflow editor store，会遇到：

- editor action 太多
- selection / edit / save / publish 语义不匹配
- runtime snapshot 与 static definition 混在一起

所以更合理的是：

- 复用 canvas 组件思路
- 复用节点视觉样式
- 新建只读 graph adapter 和轻量 store

## 8.2 推荐前端模块

建议新增：

- `src/features/meta-agent-graph/adapters`
- `src/features/meta-agent-graph/components`
- `src/features/meta-agent-graph/types`

### 关键组件

#### `MetaAgentExecutionGraph`

职责：

- 展示 todo dependency graph
- 支持 grouping/filter/highlight
- 支持 focus current todo
- 支持 select todo

#### `MetaAgentWaveBoard`

职责：

- 展示 wave-by-wave 并行执行
- 展示 self/delegate/split 模式
- 展示 wave review outcome

#### `MetaAgentStepPlayback`

职责：

- 基于 checkpoints 切 step
- 联动 graph snapshot
- 联动 control plane / issues / outputs

#### `MetaAgentChildRunsPanel`

职责：

- 展示本 session 派生的底层 runs
- 支持跳转到底层 run detail

#### `MetaAgentExecutionSidebar`

职责：

- 展示当前选中 todo 的详细信息
- assignee history
- retry / reroute / recovery
- artifacts / workspace files
- linked child runs

---

## 9. 后端设计

## 9.1 第一层：Adapter 聚合层

最推荐的第一阶段做法，是先新增聚合接口，而不是马上大改底层存储。

例如新增：

- `GET /api/meta-agent/[sessionId]/projection`
- `GET /api/meta-agent/[sessionId]/lineage`
- `GET /api/meta-agent/[sessionId]/playback?step=...`

### Projection 接口返回

```ts
interface MetaAgentProjectionView {
  sessionId: string;
  projectId?: string;
  status: string;
  graph: {
    nodes: MetaAgentExecutionNodeView[];
    edges: MetaAgentExecutionEdgeView[];
  };
  waves: MetaAgentWaveView[];
  currentFrame?: MetaAgentPlaybackFrameView;
  childExecutions: UnifiedExecutionRecord[];
}
```

### 为什么先做 adapter

因为当前数据已经分散存在于：

- session summary
- supervisorRunState
- checkpoints
- artifacts / workspace files
- execution log

先做聚合层，可以先验证产品形态，不急着动底层表结构。

## 9.2 第二层：统一索引层

等产品形态稳定后，再考虑把 meta-agent execution 纳入统一索引。

这一层可以新增：

- `execution_index`
- `execution_lineage`
- `execution_artifact_link`

但不建议一上来就做。

### 原因

现在平台里已经有不少运行相关 schema，直接重构为统一 execution DB 风险较高。

---

## 10. 如何把 Step/Todo 投影成 Workflow 风格图

这是用户最关心的部分之一。

关键判断是：

> Meta-Agent 的 step/todo 可以用 workflow 风格展示，但不应伪装成真实 workflow definition。

## 10.1 节点映射规则

### Todo 节点

- `id = todo.id`
- `title = todo.title`
- `subtitle = capability_type`
- `owner = assignee`
- `status = todo.status`
- `badges = review_result / delegation_status / retry / reroute`

### Special Nodes

可选加入轻量特殊节点：

- `goal`
- `replan`
- `wave gate`
- `terminal`

作用是让图更完整，但建议只在高级模式显示。

## 10.2 边映射规则

### 主边

来自 `depends_on`

### 动态边

来自运行期关系：

- `split_from`
- `reroute_to`
- `inserted_after_replan`
- `spawned_child_execution`

这些边可以做成不同样式：

- 实线：dependency
- 虚线：runtime-added
- 点线：lineage

## 10.3 布局建议

### 默认布局

建议采用：

- 主方向：左到右
- 同一层级按依赖排序
- 同 wave 优先聚集

### 可选布局

- 按 capability swimlane
- 按 assignee swimlane
- 按 status cluster

## 10.4 图上交互

点击 todo 节点应联动：

- 右侧 todo detail
- recovery history
- artifacts / workspace files
- child runs
- relevant execution log
- replay candidate if present

---

## 11. 与运行中心的具体融合方式

## 11.1 列表页

运行中心里建议新加 `Meta-Agent` scope。

每条记录展示：

- title: goal
- secondary: session id / project
- chips: status / current phase / owner
- metrics: steps / todos / issues / tokens / child runs

### 支持过滤

- status
- current phase
- has open issues
- has child runs
- project

## 11.2 analytics 页

建议新增：

- meta-agent status distribution
- avg todo count
- avg recovery count
- avg child runs per session
- top failure issue types
- phase duration distribution
- assignee / subagent utilization

## 11.3 detail 页

运行中心 detail 对 meta-agent run 可复用 detail shell，但内容切成 meta-agent 版本：

- Overview
- Mission Control
- Todo Graph
- Wave Board
- Playback
- Child Runs
- Traces

### 推荐结构

不要把 meta-agent detail 完全塞进现有 workflow run detail 页。

更合理的是：

- 运行中心点击后进入统一 detail route
- route 内部按 run type 选择 detail renderer

也就是：

- workflow run -> workflow detail renderer
- dev run -> dev detail renderer
- meta-agent run -> meta-agent detail renderer

这样统一导航，又不强扭语义。

---

## 12. 与项目页的融合方式

项目页建议增加一块：

### `Meta-Agent Activity`

展示：

- 最近 N 次 meta-agent runs
- 成功/失败
- 当前运行中的 session
- 最近活跃 todo
- 最近输出 artifacts

并支持：

- 跳到 meta-agent detail
- 跳到相关 workflow run
- 跳到 outputs

### 可行性判断

高。

因为这本质是项目页里多一块聚合卡片，不需要先重构底层。

---

## 13. 与评测体系的融合方式

这一块不是第一阶段必须做，但值得在方案里定方向。

### 13.1 评测对象升级

未来 evaluation 的对象不应只限于 workflow run，还应支持：

- meta-agent session
- meta-agent projection snapshot

### 13.2 compare 维度

可比较：

- total steps
- total todos
- success rate
- recovery count
- reroute count
- child run count
- output artifact diff
- issue type diff
- trajectory diff

### 13.3 replay

Meta-Agent replay 可有两种：

- full session replay
- checkpoint-based partial replay

当前已经有 checkpoint/replay candidate 雏形，所以方向上完全成立。

---

## 14. 实施路线

建议分四阶段。

## Phase 1：统一可见性

### 目标

先把 Meta-Agent 正式纳入平台目录和跳转体系。

### 内容

- 在运行中心加入 `meta_agent_run` scope
- session list 统一接入运行中心
- 新增 meta-agent run detail route
- 当前 meta-agent 页面保留为 launchpad
- 在项目页加入 `Meta-Agent Activity`

### 收益

- 平台心智统一
- session 不再是孤岛
- 先解决“找不到 / 看不全”的问题

### 风险

低。

### 可行性

高。

## Phase 2：图形化执行视图

### 目标

把 todo / wave / step 变成 workflow 风格视图。

### 内容

- 新建 `meta-agent-graph` 只读视图层
- 新增 `Todo Dependency Graph`
- 新增 `Wave Board`
- 新增 `Step Playback`
- 节点侧栏联动 artifacts/issues/recovery

### 收益

- 让复杂 session 真正可读
- 让多 agent 并行/恢复过程具象化

### 风险

中。

风险点主要在：

- 图布局策略
- 图信息过载
- 与现有 workflow 视觉体系的边界

### 可行性

高。

## Phase 3：父子运行融合

### 目标

建立 meta-agent 与底层 execution 的 lineage。

### 内容

- 为 session 派生 child execution 索引
- detail 页展示 child run tree
- 允许从 todo 直接跳到底层 run detail
- run detail 能反向追溯所属 session/todo

### 收益

- 真正打通平台运行谱系
- 诊断效率显著提升

### 风险

中高。

因为这需要更严格的运行索引与关联关系。

### 可行性

中高。

## Phase 4：统一 replay / compare / control actions

### 目标

把 meta-agent 真正纳入平台控制闭环。

### 内容

- replay ticket
- compare session
- partial rerun
- approval queue
- terminate / reroute / retry from UI

### 收益

- 变成真正可操作 control console

### 风险

高。

因为这会从“观测融合”进入“控制融合”。

### 可行性

中。

---

## 15. 整体可行性评估

## 15.1 技术可行性

### 数据可行性：高

原因：

- todo / wave / issues / artifacts / workspace files 已存在
- checkpoints / replay candidates 已存在
- controlPlaneSummary 已存在
- session list / session detail 已存在

### 前端可行性：高

原因：

- 已有运行中心
- 已有 graph/canvas 技术栈
- 已有 meta-agent runtime panels

### 后端可行性：中高

原因：

- 第一阶段可以用 adapter 聚合，不必立刻改底层 schema
- 真正难的是 Phase 3 之后的 lineage 和统一 replay 控制

## 15.2 产品可行性

高。

因为这件事直接解决的是“平台是不是一个整体”的问题，而不是局部体验优化。

## 15.3 风险评估

### 风险 1：强行复用 workflow editor 造成语义污染

规避方式：

- 只复用展示能力，不复用编辑 store

### 风险 2：图形化后信息过载

规避方式：

- 分三种图，而不是一个图试图表达一切
- 默认只给主视图
- 高级信息折叠

### 风险 3：历史 session 数据不完整

规避方式：

- 先从“新 session 完整、新老兼容降级显示”开始

### 风险 4：lineage 做太早，改动过大

规避方式：

- Phase 1/2 先以 projection 为主
- Phase 3 再做统一 execution 索引

---

## 16. 推荐决策

如果只做一个判断，我的建议是：

> 应该推进，而且应当按“统一可见性 -> 图形化执行 -> 父子运行谱系 -> 控制闭环”四阶段推进。

具体建议如下：

1. 先把 `Meta-Agent` 接进运行中心，成为一级 run type。
2. 再做 `Todo Graph + Wave Board + Step Playback` 三个图形视图。
3. 明确不把动态 todo graph 硬塞进 workflow editor store。
4. 用 adapter/projection 先跑通，再决定是否统一到底层 execution schema。
5. 等视图稳定后，再接 approval/replay/control actions。

---

## 17. 最终判断

这件事的价值，不只是让 `Meta-Agent` 页面更完整。

更大的意义在于：

- 让 `Meta-Agent` 从“独立实验功能”升级为“平台级调度与监督层”
- 让运行中心从“workflow/dev runs catalog”升级为“统一 execution catalog”
- 让 workflow 画布从“静态定义编辑器”扩展出“动态执行投影视图”

如果这条线做成，平台的整体层级会明显上一个台阶：

- workflow 是执行模板层
- meta-agent 是运行监督层
- run center 是统一观测层
- evaluation 是统一验证层

这四层会真正接起来。

唯一需要克制的地方是：

> 不要为了“统一”而强行同构。  
> Meta-Agent 和 Workflow 应该深度融合，但不应丢掉各自的运行语义。

这个 trade-off 很重要：

- 如果融合太浅，平台继续割裂
- 如果融合太猛，语义会被破坏

最好的路线是：

> 用统一目录、统一观测、统一 lineage 把它们接起来；  
> 用投影视图而不是存储同构，保留各自边界。

