# Meta-Agent V2 设计方案

## 概述

本方案针对与 LangChain Deep Agents 对比后确认的四个结构性差距，设计统一的增强方案：

1. **Adaptive Replanning** — 执行中动态调整计划
2. **Subagent 自主性升级** — 子 agent 规划 + 嵌套 + workspace 读写
3. **Context Summarization** — 对话/上下文自动压缩
4. **Workspace 双向读写** — subagent 可读写中间文件

四个特性互相关联，统一设计以避免接口冲突。

---

## 一、Adaptive Replanning（自适应重规划）

### 1.1 问题

当前 `planInitialTodos()` 一次性生成 3-5 个 todo，执行中唯一的调整手段是 `split`（拆分）。如果执行过程中发现：
- 原定方向错误（research 发现前提假设不成立）
- 发现新的子问题需要追加 todo
- 某些 todo 已无意义需要剪枝

系统无法响应，只能机械执行原计划。

### 1.2 设计

#### 触发时机

在 `runTodoDrivenStep()` 的 **review 完成后**，新增 replan checkpoint：

```
执行 → 审核 → [replan checkpoint] → 恢复/下一步
```

**触发条件**（满足任一即触发 replan 评估）：
- 已完成 todo 数 ≥ 2 且存在 `ready` 状态的 todo（有可调整空间）
- 本轮 review 结果为 `fail` 且 recovery 决策为 `fail`（彻底失败，可能需要换方向）
- 本轮 todo 的 `completion_notes` 包含"发现新问题"/"需要额外调查"等信号词
- 累计 issue 数 ≥ 3（多处出问题，可能需要全局调整）

**频率限制**：最多每 3 个 step 触发一次 replan，防止过度调整。

#### Replan 决策流程

```
触发 replan checkpoint
    │
    ▼
buildReplanContext(state)  ← 收集已完成 todo 摘要 + 失败信息 + 新发现
    │
    ▼
LLM 评估: 是否需要调整?
    │
    ├─ "no_change" → 继续原计划
    │
    ├─ "add_todos" → 新增 1-3 个 todo (带依赖关系)
    │
    ├─ "prune_todos" → 将指定 ready/todo 状态的 todo 标记为 "pruned"
    │
    └─ "replace_plan" → 剪枝所有 ready todo + 生成新 todo
```

#### 新增文件

```
src/server/meta-agent/todo-driven/replanner.ts
```

#### 核心接口

```typescript
// replanner.ts

export interface ReplanDecision {
  action: "no_change" | "add_todos" | "prune_todos" | "replace_plan";
  reason: string;
  new_todos?: TodoDraft[];        // add_todos / replace_plan 时
  prune_todo_ids?: string[];      // prune_todos / replace_plan 时
  token_usage?: LLMTokenUsage;
}

export interface ReplanContext {
  goal: string;
  completed_todos: Array<{ title: string; summary: string; key_findings?: string[] }>;
  failed_todos: Array<{ title: string; failure_reason: string }>;
  pending_todos: Array<{ id: string; title: string; status: TodoStatus }>;
  new_discoveries: string[];      // 从 completion_notes 提取
  open_issues: string[];          // 从 issues 提取
  step_count: number;
  remaining_steps: number;
}

export async function evaluateReplan(
  state: RunState,
  maxSteps: number,
  currentStep: number,
): Promise<ReplanDecision>
```

#### LLM Prompt 结构

```
你是一个项目经理，正在监督一个多步任务的执行。

## 原始目标
{goal}

## 已完成的工作
{completed_todos with summaries}

## 失败的工作
{failed_todos with reasons}

## 剩余计划
{pending_todos}

## 新发现/新问题
{new_discoveries}

## 预算
已用 {step_count}/{maxSteps} 步，剩余 {remaining} 步

## 决策
根据以上信息，判断是否需要调整计划。输出 JSON:
{
  "action": "no_change" | "add_todos" | "prune_todos" | "replace_plan",
  "reason": "调整理由",
  "new_todos": [...],      // 如需新增
  "prune_todo_ids": [...]  // 如需剪枝
}
```

#### 集成点：loop.ts

在 `runTodoDrivenStep()` 的 recovery 处理之后、return 之前：

```typescript
// loop.ts - runTodoDrivenStep() 末尾新增

const shouldReplan = checkReplanTrigger(state, review, recoveryDecision, options);
if (shouldReplan) {
  const replanResult = await evaluateReplan(state, options.maxSteps, currentStep);
  if (replanResult.action !== "no_change") {
    applyReplanDecision(state, replanResult);
    accumulateTokenUsage(state, null, "replanner", "replan", replanResult.token_usage);
    addExecutionLog(state, {
      action: "replan_applied",
      message: { action: replanResult.action, reason: replanResult.reason },
    });
  }
}
```

#### 状态变更

`supervisor-runtime-state.ts` 新增：

```typescript
// TodoItem 新增状态
// ALLOWED_TODO_TRANSITIONS 中:
//   ready: [..., "pruned"]
//   todo: [..., "pruned"]
// 新增:
//   pruned: ["pruned"]  // 终态

// RunState.metadata 新增跟踪:
//   replan_count: number
//   last_replan_step: number
```

---

## 二、Subagent 自主性升级

### 2.1 问题

当前 subagent 是"受控执行单元"：
- 不能自主规划子步骤
- 不能嵌套派发子 agent
- 不能读写中间文件
- 输出格式固定为 JSON schema
- 最多 6 轮 tool-use

与 Deep Agents 相比，缺少 subagent 作为"迷你 agent"的完整能力。

### 2.2 设计：分层自主性

不是所有 subagent 都需要完整自主性。引入 **autonomy level** 分级：

```typescript
type SubagentAutonomyLevel = "basic" | "enhanced" | "full";
```

| Level | 能力 | 适用场景 |
|-------|------|---------|
| **basic** | 单次/多轮 tool-use（当前能力） | 简单 research、writing |
| **enhanced** | + workspace 读写 + 内部规划（mini-todos） | 复杂 research、analysis |
| **full** | + 嵌套子 agent 派发 | 多阶段复合任务 |

#### 默认分配规则

```typescript
// subagent-registry.ts 中各 agent 的默认 autonomy_level:
research_agent: "enhanced"   // 研究需要多步 + 写中间文件
writer_agent: "basic"        // 写作通常一步到位
planner_agent: "basic"       // 规划由 supervisor 控制
reviewer_agent: "basic"      // 评审一步完成
analyst_agent: "enhanced"    // 分析需要多步 + 中间推理
```

Planner 也可以在 todo 里通过 `autonomy_override` 提升/降低。

### 2.3 Enhanced 层：Workspace + Mini-Plan

#### 2.3.1 Workspace 读写

给 subagent 注入两个内置工具：

```typescript
// 新增 subagent-workspace-tools.ts

const workspaceReadTool: LLMToolDefinition = {
  type: "function",
  function: {
    name: "workspace_read",
    description: "读取工作区中的文件内容（可以是前置 todo 产出的文件或本 todo 写入的中间文件）",
    parameters: {
      type: "object",
      properties: {
        file_id: { type: "string", description: "workspace_file 的 file_id" },
        max_chars: { type: "number", description: "最大读取字符数，默认 4500" },
      },
      required: ["file_id"],
    },
  },
};

const workspaceWriteTool: LLMToolDefinition = {
  type: "function",
  function: {
    name: "workspace_write",
    description: "将中间结果写入工作区文件，供后续步骤引用",
    parameters: {
      type: "object",
      properties: {
        filename: { type: "string", description: "文件名" },
        content: { type: "string", description: "文件内容" },
        kind: { type: "string", enum: ["research_notes", "intermediate_summary", "raw_tool_result", "analysis_output"] },
      },
      required: ["filename", "content"],
    },
  },
};
```

**执行回调**：在 `subagent-executor.ts` 的 `executeToolCall` 中识别这两个工具名，直接调用 workspace-files 的读写接口，而非走 `toolService`。

#### 2.3.2 Mini-Plan（内部子步骤）

给 enhanced/full 级 subagent 注入 `think_and_plan` 工具：

```typescript
const thinkAndPlanTool: LLMToolDefinition = {
  type: "function",
  function: {
    name: "think_and_plan",
    description: "在执行复杂任务前，先分解为 2-4 个子步骤并按序执行。调用后你需要按照计划逐步执行。",
    parameters: {
      type: "object",
      properties: {
        steps: {
          type: "array",
          items: { type: "string" },
          description: "子步骤列表，每个是一句话描述",
          minItems: 2,
          maxItems: 4,
        },
      },
      required: ["steps"],
    },
  },
};
```

这是一个**"no-op"工具**（与 Deep Agents 的 `write_todos` 同理）——调用后直接返回 `{ status: "planned", steps: [...] }`，实际作用是让 LLM 在对话中形成结构化的执行计划，后续轮次自然按计划执行。

#### 2.3.3 Tool-Use 轮次调整

```typescript
// 根据 autonomy level 调整 maxRounds:
basic:    6 轮（当前值）
enhanced: 12 轮
full:     20 轮
```

### 2.4 Full 层：嵌套子 Agent

#### 设计原则

- 嵌套深度限制为 **1 层**（subagent 可以派子 agent，但子 agent 不能再派）
- 嵌套通过 `delegate_subtask` 工具触发
- 子 agent 使用 `basic` autonomy level（防止递归失控）

```typescript
const delegateSubtaskTool: LLMToolDefinition = {
  type: "function",
  function: {
    name: "delegate_subtask",
    description: "将一个子任务委派给专业 agent 执行。仅在任务明确需要不同专业能力时使用。",
    parameters: {
      type: "object",
      properties: {
        task_description: { type: "string", description: "子任务描述" },
        preferred_capability: {
          type: "string",
          enum: ["research", "writing", "analysis", "review"],
          description: "所需能力类型",
        },
      },
      required: ["task_description", "preferred_capability"],
    },
  },
};
```

**执行逻辑**：

```typescript
// subagent-executor.ts 中 executeToolCall 新增分支

if (call.name === "delegate_subtask") {
  // 1. 查找匹配 capability 的 agent
  const childAgent = findAgentByCapability(call.arguments.preferred_capability);
  // 2. 构建 mini delegation brief（无嵌套标记）
  const childBrief = buildChildDelegationBrief(brief, call.arguments, childAgent);
  // 3. 递归调用 runSubagentTodo，但 autonomy_level 强制为 basic
  const childResult = await runSubagentTodo(childAgent, childBrief);
  return { status: childResult.status, summary: childResult.summary };
}
```

**安全保护**：
- `DelegationBrief` 新增 `nesting_depth: number`（默认 0）
- 当 `nesting_depth >= 1` 时，不注入 `delegate_subtask` 工具
- 嵌套 agent 的 `maxRounds` 强制为 6

### 2.5 接口变更汇总

```typescript
// subagent-registry.ts - SubagentDefinition 新增:
autonomy_level: SubagentAutonomyLevel;

// types.ts - DelegationBrief 新增:
nesting_depth?: number;
autonomy_level?: SubagentAutonomyLevel;
workspace_file_ids?: string[];  // 可读取的 workspace file ID 列表

// supervisor-runtime-state.ts - TodoItem 新增:
autonomy_override?: SubagentAutonomyLevel;
```

---

## 三、Context Summarization（上下文自动压缩）

### 3.1 问题

当前 subagent 每轮 tool-use 的对话历史只在 `callLLMWithTools()` 内部累积，没有压缩机制。当 enhanced 级 subagent 执行 12 轮时，对话可能超出 context window。

此外，supervisor 层面的 artifact_summaries 在 todo 数量多时也可能膨胀。

### 3.2 设计：两层压缩

#### 3.2.1 Subagent 层：Tool-Use 对话压缩

在 `callLLMWithTools()` 中，当累计 token 超过阈值时，压缩早期对话：

```typescript
// llm-helper.ts 新增

interface ToolLoopOptions {
  maxRounds?: number;                    // 默认 6
  contextBudgetTokens?: number;          // 默认 model max * 0.75
  compactionTriggerRatio?: number;       // 默认 0.7 (70% 时触发压缩)
}

async function compactToolConversation(
  messages: LLMMessage[],
  keepRecentCount: number,    // 保留最近 N 条消息不压缩
): Promise<{ compacted: LLMMessage[]; summary: string }> {
  // 1. 分离: [system] + [early messages] + [recent keepRecentCount messages]
  // 2. LLM 压缩 early messages → 1 条 summary message
  // 3. 返回: [system, summary_message, ...recent_messages]
}
```

**触发逻辑**（嵌入 `callLLMWithTools` 循环内）：

```typescript
for (let round = 0; round < maxRounds; round++) {
  // 估算当前 token 数
  const estimatedTokens = estimateMessageTokens(conversationMessages);
  if (estimatedTokens > contextBudgetTokens * compactionTriggerRatio) {
    const { compacted } = await compactToolConversation(conversationMessages, 4);
    conversationMessages = compacted;
    // 压缩本身消耗的 token 也累加
  }

  // ... 正常 LLM 调用 + tool 执行
}
```

#### 3.2.2 Supervisor 层：Execution Context 压缩

当传递给 subagent 的 context 过大时（artifact_summaries 数量多），压缩历史 artifact：

```typescript
// 新增 context-compactor.ts

export function compactExecutionContext(
  context: TodoExecutionContext,
  budgetChars: number,  // 默认 6000
): TodoExecutionContext {
  // 1. 计算当前 context 总字符数
  // 2. 如果超预算:
  //    a. 保留最相关的 3 个 artifact（按 related_todo 与当前 todo 的依赖关系排序）
  //    b. 将其余 artifact 压缩为一行摘要列表
  //    c. 截断 recent_logs 到最近 5 条
  // 3. 返回压缩后的 context
}
```

集成在 `execution-context-builder.ts` 的 `buildTodoExecutionContext()` 末尾调用。

### 3.3 与现有 Offloading 的关系

```
                  大输出产出时          传递给下游 agent 时         subagent 内部多轮时
                      │                       │                         │
                      ▼                       ▼                         ▼
              Offloading Policy      Context Compactor         Tool Conversation
              (已有，存储层)         (新增，传递层)              Compaction (新增，对话层)
                      │                       │                         │
              超 1400 chars          超 6000 chars budget        超 70% context window
              → 写入本地文件         → 压缩为摘要列表            → LLM 压缩早期对话
              → 保留 inline_preview  → 保留关键 3 artifact       → 保留最近 4 条消息
```

三层各司其职，互不冲突。

---

## 四、Workspace 双向读写

### 4.1 问题

当前 workspace_files 只有"写"路径（offloading 写入），subagent 不能主动读写。subagent 产出的中间结果只能通过 JSON artifacts 返回，无法像 Deep Agents 那样把中间文件写入工作台供后续引用。

### 4.2 设计

#### 4.2.1 读取路径

扩展现有的 `resolveWorkspaceReadback()`，暴露给 subagent 的 `workspace_read` 工具：

```typescript
// workspace-files.ts 新增 export

export function readWorkspaceFile(
  state: RunState,
  fileId: string,
  maxChars: number = 4500,
): { content: string; truncated: boolean } | null {
  const wsFile = state.workspace_files.find(f => f.file_id === fileId);
  if (!wsFile) return null;

  // 从本地文件系统读取
  const fullContent = fs.readFileSync(wsFile.path, "utf-8");
  if (fullContent.length <= maxChars) {
    return { content: fullContent, truncated: false };
  }
  return {
    content: fullContent.slice(0, maxChars) + "\n...(truncated)",
    truncated: true,
  };
}
```

#### 4.2.2 写入路径

subagent 的 `workspace_write` 工具调用底层 `writeWorkspaceFileForArtifact()`：

```typescript
// subagent-executor.ts 中 executeToolCall 新增

if (call.name === "workspace_write") {
  const { filename, content, kind } = call.arguments;
  const wsFile = writeWorkspaceFileForArtifact(
    state, todo, agent.id,
    kind || "intermediate_summary",
    content, filename,
    content.slice(0, 200),  // summary
  );
  return { file_id: wsFile.file_id, path: wsFile.path, size: content.length };
}
```

**注意**：需要把 `state` 和 `todo` 传入 `executeToolCall` 的闭包作用域。

#### 4.2.3 可见性控制

subagent 只能读取：
1. 自己写入的 workspace files（本次执行中通过 `workspace_write` 写入的）
2. `DelegationBrief.workspace_file_ids` 中列出的文件（supervisor 显式授权的前置 todo 产出）

```typescript
// delegation-brief-builder.ts 修改

function resolveReadableWorkspaceFiles(
  state: RunState,
  todo: TodoItem,
): string[] {
  // 收集当前 todo 依赖的所有 done todo 的 workspace file IDs
  const depTodoIds = todo.depends_on;
  return state.workspace_files
    .filter(f => depTodoIds.includes(f.related_todo))
    .map(f => f.file_id);
}
```

---

## 五、整体数据流

升级后的完整流程：

```
runTodoDrivenOrchestrator()
│
├─ Step N: runTodoDrivenStep()
│  │
│  ├─ [如果无 todo] planInitialTodos()
│  │
│  ├─ selectNextTodo() / runParallelTodoWave()
│  │
│  ├─ decideTodoExecutionMode() → delegate
│  │  │
│  │  ├─ resolveToolsForSubagent()        ← 合并 baseline + extra_tools
│  │  ├─ injectAutonomyTools()            ← [新] 根据 autonomy_level 注入工具
│  │  │   ├─ enhanced: + workspace_read/write + think_and_plan
│  │  │   └─ full:     + delegate_subtask
│  │  ├─ resolveReadableWorkspaceFiles()  ← [新] 授权可读文件列表
│  │  └─ compactExecutionContext()        ← [新] 压缩 context 到预算内
│  │
│  ├─ runSubagentTodo(agent, brief)
│  │  │
│  │  ├─ callLLMWithTools(maxRounds=6/12/20)
│  │  │  │
│  │  │  ├─ Round 1: LLM → think_and_plan → 返回子步骤
│  │  │  ├─ Round 2: LLM → tool_call → 执行 → 结果
│  │  │  ├─ Round 3: LLM → workspace_write → 保存中间结果
│  │  │  ├─ [如果 70% context] → compactToolConversation()  ← [新]
│  │  │  ├─ Round 4: LLM → delegate_subtask → 嵌套执行      ← [新, full only]
│  │  │  └─ Round N: LLM → 返回最终 JSON
│  │  │
│  │  └─ SubagentExecutionResult
│  │
│  ├─ persistExecutionArtifacts()  ← 已有 offloading
│  │
│  ├─ reviewTodoExecution()
│  │
│  ├─ [如果需要] decideRecoveryAction() → applyRecoveryDecision()
│  │
│  └─ [新] checkReplanTrigger() → evaluateReplan() → applyReplanDecision()
│
└─ determineRunTerminalState()
```

---

## 六、新增/修改文件清单

### 新增文件

| 文件 | 说明 |
|------|------|
| `todo-driven/replanner.ts` | Adaptive Replanning 核心逻辑 |
| `todo-driven/subagent-workspace-tools.ts` | workspace_read/write + think_and_plan + delegate_subtask 工具定义 |
| `todo-driven/context-compactor.ts` | Supervisor 层 context 压缩 |

### 修改文件

| 文件 | 修改内容 |
|------|---------|
| `todo-driven/loop.ts` | 末尾新增 replan checkpoint 调用 |
| `todo-driven/orchestrator.ts` | 传递 maxSteps/currentStep 给 step 函数 |
| `todo-driven/subagent-executor.ts` | executeToolCall 新增 workspace_read/write/think_and_plan/delegate_subtask 分支；根据 autonomy_level 注入工具；传递 state/todo 到闭包 |
| `todo-driven/subagent-registry.ts` | SubagentDefinition 新增 autonomy_level 字段 |
| `todo-driven/delegation-brief-builder.ts` | 新增 resolveReadableWorkspaceFiles()；注入 autonomy 相关字段 |
| `todo-driven/types.ts` | DelegationBrief 新增 nesting_depth/autonomy_level/workspace_file_ids |
| `supervisor-runtime-state.ts` | TodoItem 新增 autonomy_override；TodoStatus 新增 "pruned"；metadata 新增 replan 跟踪 |
| `llm-helper.ts` | callLLMWithTools 新增 ToolLoopOptions 参数；内部新增 compactToolConversation() |
| `todo-driven/workspace-files.ts` | 新增 readWorkspaceFile() export |
| `todo-driven/execution-context-builder.ts` | 末尾调用 compactExecutionContext() |

---

## 七、实现优先级

按依赖关系和收益排序：

### Phase 1 — 基础设施（无破坏性变更）
1. **Context Compactor** — 独立模块，仅新增，不改现有逻辑
2. **Workspace Read** — 暴露现有 workspace_files 的读取接口
3. **Tool Conversation Compaction** — 在 callLLMWithTools 内部新增，对外接口不变

### Phase 2 — Subagent 增强
4. **Subagent Workspace Tools** — 注入 workspace_read/write/think_and_plan
5. **Autonomy Level** — 分级机制 + 工具注入逻辑
6. **Enhanced Subagent Prompt** — 更新 system_prompt 指导使用新工具

### Phase 3 — 编排增强
7. **Adaptive Replanning** — replanner.ts + loop.ts 集成
8. **Pruned 状态** — 状态机扩展

### Phase 4 — 高级能力
9. **Nested Delegation** — delegate_subtask 工具 + 嵌套执行
10. **Planner Autonomy Hints** — planner 可为 todo 指定 autonomy_override

---

## 八、风险与约束

| 风险 | 缓解措施 |
|------|---------|
| Replan 过度调整导致原地打转 | 频率限制（每 3 步最多 1 次）+ 最大 replan 次数上限（3 次） |
| 嵌套 agent 递归失控 | 硬限制 nesting_depth ≤ 1；嵌套 agent 强制 basic level |
| Context compaction 丢失关键信息 | 保留最近 4 条消息不压缩；压缩 prompt 要求保留关键发现和工具结果 |
| Workspace 文件膨胀 | 继承现有 retention 策略；ephemeral 文件在 run 结束后可清理 |
| LLM 不理解 think_and_plan 是 no-op | system_prompt 明确说明"这是一个规划工具，调用后按计划逐步执行" |
| Autonomy level 选择不当 | 默认值保守（大部分 basic）；运行时可通过 memory 学习调整 |

---

## 九、与现有系统的兼容性

- **Bandit 系统**：不受影响，仍在 workflow template 层面选择
- **Memory/ProjectState**：replan 事件可被记录为新的 memory 类型（"哪些目标类型需要 replan"）
- **Wave 并行**：replan 不会在 wave 执行中触发（仅在 step 级别）
- **Review 系统**：不变，仍然是 replan 的输入信号之一
- **Offloading**：不变，workspace 读写复用现有 offloading 基础设施
- **前端**：replan 事件通过现有 onProgress 回调推送，前端展示 "计划已调整" 提示即可
