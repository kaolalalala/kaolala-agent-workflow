# Runtime Control Plane 设计方案

## 概述

这份方案的目标，不是再发明一个“更聪明的主脑”，而是为当前平台补上一套更强的 **Runtime Control Plane**。  
核心思想是三句话：

1. **模型负责提议，不负责提交。**
2. **Runtime 负责执行控制，不负责创造目标。**
3. **人类负责宪法级规则和高风险审批，不负责盯每一步。**

这套设计适用于当前平台已有的几类能力：

- Workflow / DAG 编排
- 多 Agent / Meta-Agent 委派
- Tool calling 与本地执行
- Human-in-the-loop
- Checkpoint / Replay / Partial Rerun
- Evaluation / Compare / Report

---

## 一、为什么需要这套方案

当前行业里多 Agent 系统越来越趋同，背后反映的是同一批结构性问题：

- Agent 之间大量靠自然语言传任务，缺少 typed protocol
- 谁拥有当前任务控制权不清楚，handoff / subtask / review 容易混
- 失败恢复经常只是“再问模型一次”，没有显式 recovery policy
- 是否允许执行、是否必须审批、是否还能继续，很多时候埋在 Prompt 里
- Checkpoint、Replay、Partial Rerun 还没有进入统一运行语义
- UI 往往只展示结果，不展示运行时控制信息

如果不把这些问题提升到 runtime 层解决，平台继续做大后会遇到三个硬上限：

- **不稳**：长任务越来越容易漂，失败恢复不可控
- **不可审计**：发生错误动作后很难追责和复盘
- **不可扩展**：Agent 越多，协调和治理越混乱

---

## 二、设计目标

本方案追求的不是“绝对自治”，而是“**有边界的自治**”。

### 2.1 主要目标

- 明确三层控制权归属
- 把 state、action、owner、budget、approval、checkpoint 变成一等运行对象
- 让 retry / reroute / fallback / terminate 成为显式 runtime 决策
- 让 Checkpoint / Replay / Partial Rerun 进入统一语义
- 让多 Agent 协作从自然语言消息升级为 typed protocol
- 让操作员、工程师、审批人分别看到自己需要的运行视图

### 2.2 非目标

- 不追求让主脑拥有无限制提交权
- 不追求用 Prompt 替代 runtime policy
- 不追求在第一阶段就做分布式重构
- 不追求让所有信息默认同时展示在主界面

---

## 三、三层分权模型

### 3.1 分权原则

控制权不属于单一角色，而是按层分配：

- **人类层（Constitutional Layer）**
  - 定义目标、红线、预算上限、工具边界、审批规则、kill switch
  - 对高风险动作拥有最终批准权
  - 对策略系统拥有最终停机权和 override 权

- **Runtime / Controller 层（Executive Layer）**
  - 管理 state machine、调度、动作校验、重试、恢复、终止
  - 决定是否允许执行某个 action
  - 决定何时 checkpoint、何时 replay、何时 partial rerun
  - 决定是否触发 human approval 或 fallback

- **Agent / Planner / Meta-Agent 层（Deliberation Layer）**
  - 提出 plan、subtask、next action、replan、review directive
  - 在授权范围内自主决策
  - 不直接拥有不可逆副作用的提交权

### 3.2 一句话定义

> 人类定宪法，Runtime 掌执行，Agent 只提议。

### 3.3 权限矩阵

| 能力 | 人类 | Runtime / Controller | Agent / Meta-Agent |
|------|------|----------------------|--------------------|
| 设定目标 | 主导 | 只读取 | 可细化，不可改写原目标 |
| 设定预算上限 | 主导 | 执行与扣账 | 可请求调整，不可自增 |
| 定义可用工具边界 | 主导 | 强制校验 | 在边界内选择 |
| 生成 next action | 可 override | 校验后执行 | 主导提议 |
| 执行高风险动作 | 审批 / 否决 | 调用审批流 | 不可直接提交 |
| Retry / Reroute / Fallback / Terminate | 可 override | 主导执行 | 可建议 |
| Checkpoint / Replay / Partial Rerun | 触发或允许 | 主导执行 | 可建议 |
| 修改平台策略 | 主导 | 载入执行 | 不可直接修改 |

### 3.4 一个关键约束

**模型永远不应直接拥有不可逆副作用的提交权。**  
它可以提出“我要执行这个动作”，但提交动作必须经过 runtime policy gate。

---

## 四、总体架构

### 4.1 三平面结构

建议把当前平台逻辑明确拆成三平面：

```text
┌───────────────────────────────────────────────────────┐
│ Human / Policy Plane                                  │
│ goals, limits, approval rules, tool policy, kill     │
└───────────────────────┬───────────────────────────────┘
                        │
┌───────────────────────▼───────────────────────────────┐
│ Runtime Control Plane                                 │
│ state machine, owner, allowed actions, budget,       │
│ retry/reroute/fallback/terminate, checkpoint, replay │
└───────────────────────┬───────────────────────────────┘
                        │
┌───────────────────────▼───────────────────────────────┐
│ Execution Plane                                       │
│ model calls, tool executor, browser actions, scripts │
└───────────────────────┬───────────────────────────────┘
                        │
┌───────────────────────▼───────────────────────────────┐
│ Observation Plane                                     │
│ trajectory, traces, evaluation, compare, dashboards  │
└───────────────────────────────────────────────────────┘
```

### 4.2 关键判断

如果一个系统里：

- state 是从日志里猜出来的
- allowed action 是模型自己想出来的
- retry / terminate 规则藏在 Prompt 里
- approval 只是“人工另开窗口沟通”

那它就还没有真正的 control plane。

---

## 五、核心运行对象

这一步是整个方案最关键的部分：  
**只有先把对象建模为一等公民，后面才谈得上展示和追踪。**

### 5.1 Run

表示一次完整运行。

建议字段：

```ts
type RunStatus =
  | "pending"
  | "running"
  | "waiting_human"
  | "blocked_policy"
  | "retrying"
  | "completed"
  | "failed"
  | "terminated";

interface RunRecord {
  run_id: string;
  workflow_id?: string;
  session_id?: string;
  status: RunStatus;
  goal: string;
  owner_kind: "runtime" | "planner" | "worker" | "meta_agent" | "human";
  active_node_id?: string;
  current_checkpoint_id?: string;
  budget_snapshot: BudgetSnapshot;
  started_at: string;
  updated_at: string;
  terminated_reason?: string;
}
```

### 5.2 NodeRun / TaskRun

表示一个节点或子任务的执行单元。

```ts
type NodeStatus =
  | "pending"
  | "ready"
  | "running"
  | "waiting_input"
  | "waiting_approval"
  | "retrying"
  | "completed"
  | "failed"
  | "skipped"
  | "terminated";
```

### 5.3 ActionEnvelope

这是 typed protocol 的核心对象。  
Agent 不能直接说“我觉得应该点一下按钮”，而要提交带类型的动作信封。

```ts
interface ActionEnvelope {
  action_id: string;
  action_type: string;
  proposer: "planner" | "worker" | "meta_agent" | "runtime_rule";
  target_scope: "node" | "subtask" | "browser" | "tool" | "memory";
  payload: Record<string, unknown>;
  required_capabilities: string[];
  side_effect_level: "none" | "low" | "medium" | "high" | "critical";
  approval_required: boolean;
  idempotency_key?: string;
  budget_cost_estimate?: BudgetCost;
  success_criteria?: string;
  fallback_policy?: "retry" | "reroute" | "fallback" | "terminate";
}
```

### 5.4 OwnershipLease

谁当前拥有任务控制权，不能靠“默认觉得是主脑”来表达。

```ts
interface OwnershipLease {
  lease_id: string;
  run_id: string;
  owner_kind: "runtime" | "planner" | "worker" | "meta_agent" | "human";
  owner_ref: string;
  scope: "run" | "node" | "subtask";
  granted_at: string;
  expires_at?: string;
  transferred_by?: string;
  transfer_reason?: string;
}
```

### 5.5 BudgetLedger

预算不是最终报表，而是运行中的可扣账对象。

```ts
interface BudgetSnapshot {
  max_steps?: number;
  used_steps: number;
  max_tokens?: number;
  used_tokens: number;
  max_cost_usd?: number;
  used_cost_usd: number;
  max_wall_ms?: number;
  used_wall_ms: number;
}
```

### 5.6 Checkpoint

Checkpoint 不是普通日志，而是可恢复边界。

```ts
interface CheckpointRecord {
  checkpoint_id: string;
  run_id: string;
  node_id?: string;
  state_hash: string;
  input_refs: string[];
  output_refs: string[];
  artifact_refs: string[];
  budget_snapshot: BudgetSnapshot;
  owner_snapshot: OwnershipLease;
  created_at: string;
}
```

### 5.7 ApprovalRequest

审批要进入统一运行对象，而不是额外聊天。

```ts
interface ApprovalRequest {
  approval_id: string;
  run_id: string;
  action_id: string;
  risk_level: "medium" | "high" | "critical";
  reason: string;
  requested_by: string;
  status: "pending" | "approved" | "rejected" | "expired";
  approved_by?: string;
  approved_at?: string;
}
```

### 5.8 ReplayTicket

Replay 不是“再跑一次”，而是“基于可比边界重放”。

```ts
interface ReplayTicket {
  replay_id: string;
  source_run_id: string;
  from_checkpoint_id?: string;
  scope: "full" | "node" | "subgraph";
  invalidated_nodes: string[];
  preserved_artifacts: string[];
  comparison_baseline_id?: string;
}
```

### 5.9 TrajectoryEvent

所有控制动作都要写入 trajectory。

建议事件类型：

- `run_created`
- `state_entered`
- `ownership_transferred`
- `action_proposed`
- `action_rejected_by_policy`
- `action_started`
- `action_succeeded`
- `action_failed`
- `retry_scheduled`
- `reroute_triggered`
- `fallback_selected`
- `approval_requested`
- `approval_granted`
- `approval_rejected`
- `checkpoint_written`
- `replay_started`
- `partial_rerun_started`
- `terminated`

---

## 六、状态机设计

### 6.1 Run State Machine

```text
pending
  ↓
running
  ├─→ waiting_human
  ├─→ blocked_policy
  ├─→ retrying
  ├─→ completed
  ├─→ failed
  └─→ terminated
```

规则：

- `waiting_human` 只能来自需要输入或审批的节点
- `blocked_policy` 表示动作被 runtime gate 拒绝，但 run 不一定失败
- `retrying` 必须记录 retry count 和 retry reason
- `terminated` 必须带明确终止原因

### 6.2 Node State Machine

```text
pending → ready → running
running → waiting_input
running → waiting_approval
running → retrying
running → completed
running → failed
running → terminated
retrying → running
waiting_input → running
waiting_approval → running
```

### 6.3 Ownership State Machine

控制权流转要显式化：

```text
runtime
  ↔ planner
  ↔ worker
  ↔ meta_agent
  ↔ human
```

流转规则：

- planner 不可直接把高风险控制权转给 worker 并绕过审批
- human 拿到控制权后，可以选择继续、拒绝、terminate
- runtime 可以因 policy 违规强制收回控制权

---

## 七、Typed Protocol 设计

### 7.1 为什么必须 typed

如果 Agent 之间主要通过自然语言沟通，会有几个问题：

- 无法校验消息是不是合法动作
- 无法知道这是一条建议还是提交请求
- 无法稳定比较 replay 前后差异
- 无法把 owner、budget、approval 绑定到动作上

因此，本方案要求至少四类消息 typed 化。

### 7.2 四类核心协议

#### 1. PlanProposal

```ts
interface PlanProposal {
  plan_id: string;
  proposer: string;
  tasks: Array<{
    task_id: string;
    title: string;
    goal: string;
    success_criteria: string;
    allowed_actions: string[];
    budget_limit?: Partial<BudgetSnapshot>;
  }>;
}
```

#### 2. ActionProposal

Agent 请求执行某个动作。

#### 3. ObservationEnvelope

工具返回、页面状态变化、人工反馈、外部系统结果都必须结构化。

#### 4. ReviewDirective

review / reflection 不应该只返回一段话，而要返回 directive：

```ts
interface ReviewDirective {
  decision: "continue" | "retry" | "reroute" | "fallback" | "terminate";
  reason: string;
  target_node_id?: string;
  patch_to_state?: Record<string, unknown>;
}
```

### 7.3 一个浏览器动作示例

```json
{
  "action_id": "act_108",
  "action_type": "browser_click",
  "proposer": "worker",
  "target_scope": "browser",
  "payload": {
    "selector": "[data-testid='login-button']",
    "intent": "open_login_form"
  },
  "required_capabilities": ["browser.click"],
  "side_effect_level": "medium",
  "approval_required": false,
  "idempotency_key": "page_home_click_login",
  "budget_cost_estimate": {
    "used_steps": 1,
    "used_tokens": 0,
    "used_cost_usd": 0,
    "used_wall_ms": 1500
  },
  "success_criteria": "login dialog visible",
  "fallback_policy": "reroute"
}
```

---

## 八、Policy Engine 设计

### 8.1 Policy 输入

Policy Engine 应基于以下维度做决策：

- 当前 run state
- 当前 node role
- 当前 owner
- allowed capabilities
- tool policy
- side effect level
- 剩余 budget
- human approval 规则
- 环境约束（本地路径、凭证可见范围、浏览器权限等）

### 8.2 Policy 输出

```ts
interface PolicyDecision {
  allowed: boolean;
  allowed_actions?: string[];
  approval_required?: boolean;
  reason_code?: string;
  recovery_policy?: "retry" | "reroute" | "fallback" | "terminate";
  checkpoint_before_execute?: boolean;
}
```

### 8.3 典型规则

- 高风险副作用动作默认 `approval_required = true`
- 当前 budget 低于阈值时，不允许再发起高成本搜索或大模型调用
- 路径类动作必须在工作区白名单内
- 某些节点角色默认 `disabled` 指定工具集
- 连续失败达到阈值后，自动从 `retry` 切换为 `fallback` 或 `terminate`

---

## 九、执行循环设计

建议控制循环如下：

```text
1. 读取当前 run state / owner / budget
2. 装配当前节点上下文
3. Agent 产出 PlanProposal / ActionProposal / ReviewDirective
4. Policy Engine 校验
5. 若不允许：
   - 写 trajectory event
   - 触发 reroute / fallback / terminate
6. 若允许且需审批：
   - 写 approval request
   - run 进入 waiting_approval
7. 若允许且无需审批：
   - 可选写 checkpoint
   - 执行动作
   - 回写 observation / state patch
8. 判断：
   - continue
   - retry
   - reroute
   - fallback
   - terminate
9. 必要时写 checkpoint / replay ticket / compare marker
10. 推进下一节点或结束 run
```

### 9.1 一个关键原则

**Action 先校验，后执行；执行后写 observation，而不是直接写 conclusion。**

这样才能把“做了什么”和“认为发生了什么”区分开。

---

## 十、Checkpoint / Replay / Partial Rerun

### 10.1 什么时候写 Checkpoint

建议至少在以下时机写：

- 进入高风险副作用前
- 节点完成后
- human approval 前
- 长链路阶段切换前
- meta-agent 完成一个 delegation wave 后

### 10.2 Checkpoint 必须保存什么

- 当前 run / node state
- 当前 owner
- 当前 budget
- 当前上下文摘要 hash
- 当前输入输出引用
- 当前关键 artifact 引用
- 当前工具结果引用

### 10.3 Partial Rerun 规则

Partial Rerun 不是“选个节点重跑”这么简单。  
至少要有 invalidation 规则：

- 若节点输入依赖被改变，则下游全部失效
- 若节点仅消费稳定 artifact，可保留上游结果
- 若副作用已落地且不可重放，需要转人工确认
- 若 replay 边界不完整，则禁止 partial rerun

### 10.4 Replay 的正确语义

Replay 不是为了“复现同样一句输出”，而是为了比较：

- action 轨迹是否变了
- recovery path 是否变了
- budget 消耗是否变了
- 终止方式是否变了

---

## 十一、可观测性与展示方案

### 11.1 总原则

必须可观测，但不应该默认全展示。  
建议按角色分三种视图。

### 11.2 Operator View

给日常操作员的运行视图，显示：

- 当前 run state
- 当前 owner
- 当前节点
- 剩余 budget
- 待审批动作
- 最近 checkpoint
- 当前阻塞原因

适合放在 Run Detail 顶部概览区域。

### 11.3 Engineer View

给工程师和调试者的深度视图，显示：

- 完整 trajectory timeline
- state transition log
- action envelope
- policy decision log
- retry / reroute / fallback / terminate 事件
- checkpoint 列表
- replay / compare 入口

### 11.4 Approver View

给审批人看的动作审核视图，显示：

- 动作类型
- 影响范围
- side effect level
- 申请原因
- 审批后果
- 当前可选动作：批准 / 拒绝 / 转人工处理 / terminate run

### 11.5 图形展示建议

在 workflow 画布上叠加：

- 节点 state badge
- owner badge
- checkpoint 图标
- rerunnable 标记
- waiting approval 标记
- failure policy 标记

在右侧 inspector / 详情抽屉中展示：

- 当前 allowed actions
- 当前 budget snapshot
- 当前 owner lease
- 当前 recovery policy

---

## 十二、如何追踪这八类关键信息

这一节直接对应平台必须显式展示和追踪的八个问题。

### 12.1 当前处于哪个 state

实现方式：

- Run 和 Node 都持久化显式 state 字段
- 所有迁移都写 `state_entered` 事件
- transition 必须带 `reason_code`

展示方式：

- Run 顶部显示全局 state
- 画布节点显示节点 state
- 时间线显示状态迁移顺序

### 12.2 下一步允许什么 action

实现方式：

- 由 Policy Engine 动态计算 `allowed_actions`
- 计算结果持久化为 policy decision 事件

展示方式：

- 当前节点侧栏直接展示 `allowed_actions`
- 被拒绝的动作展示 `reason_code`

### 12.3 谁拥有当前任务控制权

实现方式：

- 用 `OwnershipLease` 持久化 owner
- 所有 transfer 写 `ownership_transferred`

展示方式：

- Run header 显示当前 owner
- 每次控制权变更在 timeline 中高亮

### 12.4 budget 还剩多少

实现方式：

- 使用 `BudgetLedger`
- 每次模型调用、工具调用、等待、重跑都扣账

展示方式：

- 顶部显示 step / token / cost / wall-time
- 超阈值时高亮提醒

### 12.5 失败后是 retry、reroute、fallback 还是 terminate

实现方式：

- recovery policy 独立建模
- 每次恢复决策写 trajectory event

展示方式：

- 当前节点展示默认 failure policy
- 实际发生时在 timeline 里显示决策路径

### 12.6 哪些动作要 checkpoint

实现方式：

- action 上可打 `checkpoint_before_execute`
- runtime 自动在关键动作前写 snapshot

展示方式：

- 节点和时间线显示 checkpoint 标记
- 支持从 checkpoint 恢复

### 12.7 哪些结果可以 replay / partial rerun

实现方式：

- 保存 dependency scope 和 invalidation 规则
- 生成 `ReplayTicket`

展示方式：

- 图上高亮可重跑子图
- 详情页显示保留结果和失效结果

### 12.8 哪些副作用必须 human approval

实现方式：

- side effect level + approval policy 联合判定
- 生成 `ApprovalRequest`

展示方式：

- 单独 approval queue
- 节点上显示 waiting approval 状态

---

## 十三、与当前平台的结合方式

这套方案不是要推翻当前平台，而是对现有能力做“语义升级”。

### 13.1 Workflow 层

现有 workflow 节点继续保留，但每个节点补上：

- 显式 state
- owner
- allowed actions
- checkpoint policy
- recovery policy

### 13.2 Run Center

现有运行中心可升级成三块：

- 状态面板：state / owner / budget / approvals
- 轨迹面板：timeline / action / policy / recovery
- 恢复面板：checkpoint / replay / partial rerun

### 13.3 Evaluation

现有评测体系可直接吃这套运行对象：

- 比较 action diff
- 比较 state path diff
- 比较 recovery path diff
- 比较 budget diff

### 13.4 Meta-Agent

Meta-Agent 不再是自由浮动的“上层 prompt”，而是变成一种 owner / proposer：

- 可以提出 replan
- 可以提出 delegation
- 可以触发 review directive
- 不能直接绕过 runtime policy 提交高风险动作

---

## 十四、分阶段实施建议

### Phase 1：运行对象显式化

目标：

- 补齐 Run / Node / Action / Budget / Ownership / Checkpoint 这几个核心对象
- 让 state machine 显式化
- 让 trajectory event 类型化

交付：

- 新的运行持久化结构
- 基础 timeline
- owner / budget / state 可见

### Phase 2：Policy Gate 与 Approval

目标：

- 加入 allowed action 计算
- 加入 recovery policy
- 加入 approval request

交付：

- action 校验前置
- human approval queue
- 失败后分流更清晰

### Phase 3：Checkpoint / Replay / Partial Rerun

目标：

- 建立可恢复边界
- 支持局部重跑
- 支持 compare 路径

交付：

- checkpoint 列表
- replay ticket
- rerun scope 可视化

### Phase 4：Meta-Agent 接入 Control Plane

目标：

- 把 meta-agent 纳入 owner / proposer / reviewer 体系
- 支持 delegation wave 和策略级 replan

交付：

- meta-agent 的 typed directive
- strategy trajectory
- replan / fallback / terminate 更可控

---

## 十五、成功指标

建议用下面几类指标验证这套方案有没有真的提升平台：

- 长任务成功率是否提升
- 平均 retry 次数是否下降
- 无效工具调用比例是否下降
- 人工审批命中率是否合理
- Partial Rerun 使用率是否提升
- 故障定位时间是否缩短
- Replay / Compare 的稳定性是否提升
- 高风险动作误执行次数是否下降

---

## 十六、主要 Trade-off

这套方案不是没有代价，主要 trade-off 有四个：

- **建模变重**：要维护更多运行对象和状态迁移
- **UI 变复杂**：必须做分层展示，否则信息过载
- **接入门槛变高**：新工具、新 Agent 必须遵守 typed protocol
- **策略调试本身也需要评测**：runtime 变强后，policy 也会成为新的调优对象

但这几个代价，本质上都是为了换一个东西：

> 把“多 Agent 系统靠运气跑通”升级成“多 Agent 系统靠 runtime 稳定运行”。

---

## 十七、最终判断

如果平台后续要继续往多 Agent、Meta-Agent、Browser Agent 和企业级方向走，  
最值得先投入的，不是再加几个角色名，而是先把 Runtime Control Plane 立起来。

因为真正决定系统上限的，不是 Agent 会不会说，而是：

- 它有没有边界
- 它能不能被追踪
- 它出了错能不能被纠正
- 它做了动作能不能被审计
- 它走偏以后能不能被 reroute 或 terminate

这套方案的价值，就是把这些“以前靠经验”的东西，变成平台里明确、可执行、可观察、可演进的运行语义。
