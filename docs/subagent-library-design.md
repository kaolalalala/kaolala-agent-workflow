# Subagent Library 设计稿

## 1. 背景

当前平台已经有一套可运行的 subagent library，包含 `research_agent`、`writer_agent`、`planner_agent`、`reviewer_agent`、`analyst_agent` 五个基础角色。它们已经能覆盖信息搜集、写作、拆解、评审、分析这些常见需求，作为第一版能力库是成立的。

但随着任务复杂度上升，这套 library 也暴露出一个越来越明显的问题：**角色是有的，但执行边界还不够硬**。

典型症状有三类：

- `research_agent` 负责范围过宽。搜索、筛选、下载、初步结构化都可能被塞进同一个 agent，任务稍复杂就容易把 discovery 和 collection 混成一团。
- `analyst_agent` 与 `reviewer_agent` 的边界不够清。一个偏“分析推理”，一个偏“质量审视”，但两者都缺少稳定的工程型输出合同，复杂任务里很容易都变成“再写一段看法”。
- `writer_agent` 容易被误用到最终交付链路。它适合表达和整理，不适合承担“最终文件数量是否正确、路径是否存在、schema 是否一致”这种 deterministic correctness 责任。

这类问题在简单任务里不明显，因为上下文短、失败代价低、人工还能快速兜底；但到了并行下载、多批次合并、Browser Agent、长链路 workflow 这类任务，问题就会统一暴露出来：

- 没有一个 agent 明确只负责 raw material collection。
- 没有一个 agent 明确只负责 deterministic verification。
- 没有一个 agent 明确只负责并行结果 fan-in merge。
- 本该属于 runtime 的 checkpoint、retry、reroute、fallback、terminate、budget control，被过多寄希望于角色提示词。

所以这次 redesign 的目标不是“再造几个更聪明的人格”，而是把 subagent library 从“能力标签库”升级成“执行边界清晰的操作员库”。

## 2. 设计目标

- 保留现有五个 subagent，不破坏已有基础能力。
- 新增更有工程边界的 operator 类 subagent，让复杂任务有稳定落点。
- 明确哪些问题应该由 agent 解决，哪些问题必须回收到 runtime/controller。
- 让 delegation 不再主要依赖自然语言理解，而更多依赖 typed capability 和 structured task。
- 让每个 subagent 的输入、输出、可用工具、失败语义都可被 runtime 感知和治理。

## 3. 非目标

- 不追求把所有任务都拆成多 agent。
- 不追求为每一种思维方式都建一个人格化角色。
- 不追求让 planner、reviewer、critic 这类“上层角色”拥有真实执行控制权。
- 不把 retry、checkpoint、approval、final delivery 这类 runtime 责任下放给 subagent。

## 4. 核心原则

### 4.1 Agent 必须按执行边界定义，而不是按人格定义

一个 agent 是否应该存在，判断标准不是“它听起来像一个合理岗位”，而是它是否同时满足三件事：

- 有稳定的任务边界。
- 有独立的输入输出合同。
- 有和其他 agent 明显不同的工具或环境使用方式。

如果只是在 prompt 里换了一个口吻，但没有新增执行边界，这通常不应该是一个新 subagent。

### 4.2 Runtime 拥有控制权，Subagent 只拥有提议权和局部执行权

subagent 可以提 plan、提 action、产出 artifact，但不应该拥有以下权力：

- 自主修改全局 budget。
- 自主跳过 approval gate。
- 自主决定 terminate 整个 run。
- 自主决定最终交付已经完成。

这些都属于 runtime/controller。

### 4.3 复杂任务优先使用 structured task，而不是开放式自由委派

如果任务可以被表达成稳定的结构化操作，例如：

- 搜索并下载一批论文
- 抓取一个网页的一组字段
- 校验一个 artifact manifest
- 合并多个并行批次输出

那就应该优先路由到有明确合同的 operator agent，而不是直接交给泛化 research 或 analyst。

### 4.4 输出要以 artifact 和 directive 为中心，而不是长文本自述

每个 subagent 的输出应该优先是：

- artifact
- manifest
- verification result
- merge result
- review directive
- next action suggestion

而不是先来一段长总结，再试图从总结里反推结果。

## 5. 新的 Library 结构

新的 subagent library 建议分三层：

- 基础通用层：保留现有五个 subagent，负责通用认知能力。
- 执行边界层：新增 collection、verification、merge 这类工程型 agent。
- 环境操作层：新增 browser、terminal 这类与运行环境强相关的 operator agent。

### 5.1 基础通用层

这一层保留现有五个 subagent，但要重新定义它们的职责边界。

#### `planner_agent`

定位：复杂目标拆解器。

负责：

- 将高层目标拆成可执行 todo。
- 提供依赖关系、批次拆分、优先级排序建议。
- 指出目标中的歧义、不完整验收标准和缺失前置条件。

不负责：

- 真正拥有 authoritative plan state。
- 直接执行工具调用。
- 决定 retry / reroute / terminate。

适合输入：

- 目标模糊、步骤较多、存在并行机会的任务。

适合输出：

- `PlanProposal`
- 子任务列表
- 依赖图建议
- 验收标准补全建议

保留理由：

- 平台里的复杂任务仍然需要 task decomposition 能力。
- 但它的角色应该更像“规划顾问”，而不是“总控主脑”。

trade-off：保留 `planner_agent` 可以提高复杂目标的可拆解性，但如果 runtime 没有自己的 plan validation，它仍然可能产出看起来合理、实际上不可执行的 todo。

#### `research_agent`

定位：信息发现与证据搜寻 agent。

负责：

- 搜索候选来源。
- 比较不同来源的相关性和可信度。
- 形成初步 evidence bundle。
- 给 collection 或 analyst 提供候选材料。

不负责：

- 大批量原始文件下载的稳定执行。
- 最终 deterministic 交付。
- 并行结果合并。

适合输入：

- 需要“先找有哪些可能材料”的任务。

适合输出：

- 候选来源清单
- 结构化 evidence bullets
- open questions
- source ranking

保留理由：

- 平台需要 discovery 能力，不能把“找资料”和“真正取回原始材料”完全合并。

trade-off：`research_agent` 继续保留可以覆盖开放式调研场景，但如果不把 collection 职责拆出去，它依然容易回到“大而全 research agent”的旧模式。

#### `analyst_agent`

定位：分析、比较、归纳、解释 agent。

负责：

- 对已有材料做比较和归纳。
- 输出结构化 trade-off、结论、风险判断。
- 对多个候选方案做 reasoning 和 synthesis。

不负责：

- 文件存在性校验。
- schema 正确性校验。
- 并行结果的 deterministic merge。

适合输入：

- 已经有材料，需要形成分析结果的任务。

适合输出：

- comparison matrix
- evidence-backed conclusion
- 风险与限制分析
- recommendation

保留理由：

- 平台里大量任务需要“解释和判断”，这不是 verifier 或 merge agent 能替代的。

trade-off：`analyst_agent` 能提升推理质量，但如果输入证据本身不可靠，它也只能在脏数据上做高质量推理。

#### `reviewer_agent`

定位：质量审视与标准对照 agent。

负责：

- 对照验收标准做 pass/fail 级别的 qualitative review。
- 识别内容层面的缺口、不完整论证、表达问题、逻辑跳步。
- 输出 review directive。

不负责：

- 做文件系统级验真。
- 充当 deterministic verifier。
- 替代 runtime 的 approval policy。

适合输入：

- 已有初稿、已有分析、已有候选结果，需要做质量审视的任务。

适合输出：

- per-criterion judgment
- issue list
- improvement directive
- continue / retry / reroute 建议

保留理由：

- 复杂任务仍然需要“内容质量复核”，而不是只有“机器验真”。

trade-off：`reviewer_agent` 很适合发现质量问题，但它给出的仍然是语义层建议，不能代替 deterministic correctness 检查。

#### `writer_agent`

定位：表达与交付包装 agent。

负责：

- 将现有材料整理成清晰文本。
- 输出报告、摘要、说明文档、交付描述。
- 根据结构化结果生成适合阅读的最终表达。

不负责：

- 判断底层 artifact 是否真的完整。
- 最终文件包的 deterministic assembly。
- 结果存在性的最终确认。

适合输入：

- 材料已经基本齐备，只差表达和组织的任务。

适合输出：

- final report
- summary
- polished sections
- delivery notes

保留理由：

- 平台不能只有“做出来”，还需要“说清楚”。

trade-off：`writer_agent` 对最终可读性帮助很大，但如果把 correctness 责任也交给它，就会让最后交付重新变成脆弱的 LLM 文字链路。

### 5.2 执行边界层

这一层是新的重点。它的目标不是增加“更会思考的角色”，而是给复杂任务增加稳定的工程操作员。

#### `collector_agent`

定位：原始材料收集 operator。

负责：

- 按查询条件抓取、下载、拉取原始材料。
- 产出带路径和元信息的 manifest。
- 对每个收集批次形成明确边界。

不负责：

- 长篇分析。
- 最终合并。
- 最终交付判断。

典型场景：

- 批量下载论文
- 拉取网页原始 HTML / JSON
- 收集外部 API 返回的数据快照

适合输出：

- `CollectionManifest`
- 本地文件路径列表
- 下载统计
- source-to-artifact 映射

为什么要单独存在：

- 当前很多“research”任务其实失败在 collection 层，而不是失败在理解层。
- 只要任务进入“要真正把原始材料落到本地”阶段，就应该从 discovery agent 切到 collector agent。

trade-off：`collector_agent` 会显著提高 raw material retrieval 的稳定性，但它本身并不回答“这些材料是否足够好”，所以通常还需要后续 verification 或 analysis。

#### `verification_agent`

定位：结果验真 operator。

负责：

- 校验数量是否满足要求。
- 校验路径是否存在、文件是否可读。
- 校验 manifest、JSON、结构化输出是否满足 schema。
- 校验去重、完整性、字段一致性。

不负责：

- 重做 research。
- 重写最终报告。
- 替代 reviewer 做内容质量判断。

典型场景：

- 并行批次下载后检查是否真的有 10 + 10 个文件。
- 浏览器抓取后验证字段是否齐全。
- 汇总结果后校验交付包是否完整。

适合输出：

- `VerificationResult`
- pass/fail
- missing items
- schema violations
- retry candidate list

为什么要单独存在：

- 很多复杂任务不是“没做”，而是“做了但没验真”。
- `reviewer_agent` 能指出“质量上有问题”，但它不适合承担“路径是否存在、数量是否准确”的职责。

trade-off：`verification_agent` 会提高结果可靠性，但也会增加一次显式验证成本，尤其在大批量 artifact 场景下需要控制开销。

#### `merge_agent`

定位：并行结果 fan-in operator。

负责：

- 合并多个并行子任务的输出。
- 去重和归一化字段。
- 形成统一的中间 manifest 或 bundle。
- 标记冲突项、缺失项和可重跑项。

不负责：

- 上游再次搜集材料。
- 最终写作润色。
- 替代 runtime 做 final deterministic assembly。

典型场景：

- 2 个并行子 agent 各下载 10 篇论文后合并清单。
- 多个 browser shard 各抓取一部分页面后合并结果。
- 多来源 research 输出汇总成统一证据包。

适合输出：

- `MergedArtifactBundle`
- dedupe report
- conflict report
- downstream-ready manifest

为什么要单独存在：

- 并行任务的难点不只在分发，还在 fan-in。
- 如果没有明确的 merge boundary，最后一步很容易落回一个大而全 analyst 或 writer，导致 correctness 和 presentation 混在一起。

trade-off：`merge_agent` 能把并行结果整齐收束，但它依赖上游产物至少遵守基本合同，否则合并逻辑会变复杂。

### 5.3 环境操作层

这层 agent 的核心不是“懂一个主题”，而是“能稳定操作一种运行环境”。

#### `browser_operator_agent`

定位：浏览器环境执行 operator。

负责：

- 页面观察、DOM 定位、点击、输入、导航。
- 输出结构化 step result、页面状态摘要、失败截图引用。
- 在浏览器任务中执行局部 retry 和 observation refresh。

不负责：

- 高层目标规划。
- 最终业务结论。
- 绕过 runtime 的高风险动作审批。

典型场景：

- Browser Agent 登录流程
- 多页表单填写
- 页面信息抓取
- 页面状态验证

适合输出：

- `BrowserStepResult`
- DOM evidence
- action trace
- failure snapshot

为什么要单独存在：

- Browser 任务与普通 research 完全不是同一种执行世界。
- 它需要动作粒度、页面状态、轨迹记录、选择器稳定性，这些都应该是独立 operator 的职责。

trade-off：`browser_operator_agent` 会显著提高浏览器任务的可控性，但它需要更强的 runtime instrumentation 和更严格的 side effect policy。

#### `terminal_operator_agent`

定位：本地工作区与终端环境执行 operator。

负责：

- 执行 shell、脚本、构建、测试、文件检查。
- 产出结构化命令结果、输出摘要和 artifact 引用。
- 在安全边界内完成工程型操作。

不负责：

- 主导任务规划。
- 决定是否可以越权执行高风险命令。
- 负责最终报告叙述。

典型场景：

- 运行测试
- 批量文件处理
- 构建、打包、抓取本地数据
- 脚本化下载与清洗

适合输出：

- `TerminalExecutionResult`
- 结构化 command summary
- 生成文件清单
- pass/fail with evidence

为什么要单独存在：

- 平台已经有本地项目和终端执行能力，这类任务不应该都回落到通用 agent。
- Terminal 和 Browser 一样，属于高副作用环境，应该用明确 operator 边界承接。

trade-off：`terminal_operator_agent` 可以让工程任务更可控，但它对 policy gate、路径白名单、approval 依赖更强。

## 6. 建议暂时不要新增的 Agent

下列角色现在不建议优先新增：

- `reflection_agent`
- `critic_agent`
- `debate_agent`
- `manager_agent`
- `super_research_agent`

原因不是这些名字没有价值，而是它们通常只是“再加一层意见”，并没有新的执行边界、工具集合或 artifact 合同。过早引入只会让 delegation 图更复杂，而不会真正提高稳定性。

如果未来确实需要反思能力，更合理的做法是：

- 把 reflection 做成 runtime 的触发机制。
- 让它输出 `ReviewDirective` 或 `StatePatchProposal`。
- 在 information insufficient、candidate conflict、repeated failure 这些条件下触发。

而不是单独做一个永远在线的“反思人格”。

## 7. 新旧 Library 的关系

这次 redesign 不是推翻旧库，而是分两步升级。

### 7.1 第一阶段：保留当前五个 agent，先修正定位

- `planner_agent` 继续存在，但降级为 planning specialist，不再被视为总控。
- `research_agent` 收缩到 discovery 和 evidence sourcing，不再默认承担 raw download。
- `analyst_agent` 聚焦 reasoning 和 synthesis，不再兼任 merge 或 verifier。
- `reviewer_agent` 聚焦 qualitative review，不再承担 deterministic correctness。
- `writer_agent` 聚焦表达，不再承担 final package correctness。

### 7.2 第二阶段：新增 operator 类 agent

- 新增 `collector_agent`
- 新增 `verification_agent`
- 新增 `merge_agent`
- 新增 `browser_operator_agent`
- 新增 `terminal_operator_agent`

这一阶段的关键不是把所有任务都改成多 agent，而是让“真正有执行边界差异的任务”有稳定的 specialist 可以接。

## 8. Capability Taxonomy 建议

当前平台的 capability 仍然偏粗，主要是：

- `planning`
- `research`
- `writing`
- `analysis`
- `review`

建议扩展成：

- `planning`
- `research`
- `collection`
- `analysis`
- `review`
- `verification`
- `merge`
- `writing`
- `browser_ops`
- `terminal_ops`

兼容策略：

- 旧 capability 继续保留，保证现有逻辑不被破坏。
- 新 capability 只对新的 structured task 和新 subagent 生效。
- routing 层优先看 `structured_task.kind`，其次看 capability，最后才看自由文本。

也就是说，未来的委派优先级应该是：

1. 先判断有没有显式 structured task。
2. 如果有，就优先走 operator agent。
3. 如果没有，再回落到现有 capability 映射。
4. 如果 capability 混杂，再由 controller 先 split。

## 9. 输入输出合同建议

除了注册表元信息，controller 和 subagent 之间也需要更明确的 typed protocol。否则 library 角色再多，最后还是会退化成“几段自然语言互相转发”。

建议至少统一以下几类 handoff contract：

### 9.1 `TaskEnvelope`

所有被委派的任务，建议都先被包装成统一的任务信封：

```ts
interface TaskEnvelope {
  task_id: string;
  task_kind: string;
  capability: string;
  goal: string;
  scope_boundary: string;
  input_artifacts: string[];
  acceptance_criteria: string[];
  allowed_actions: string[];
  budget_limit?: {
    max_steps?: number;
    max_tokens?: number;
    max_wall_ms?: number;
  };
  failure_policy?: "retry" | "reroute" | "fallback" | "terminate";
}
```

这个对象的价值在于把几件事明确下来：

- 任务到底是什么。
- 这个 agent 只能做哪些动作。
- 它的 scope boundary 到哪里结束。
- 它需要满足哪些验收标准。
- 失败后 controller 允许什么恢复方式。

### 9.2 `CollectionManifest`

`collector_agent` 的输出不应该是一段“我下载好了”的说明，而应该是稳定的 manifest：

```ts
interface CollectionManifest {
  collection_id: string;
  query: string;
  batch_range?: string;
  item_count: number;
  items: Array<{
    title: string;
    source_url?: string;
    file_path: string;
    checksum?: string;
    metadata?: Record<string, unknown>;
  }>;
}
```

### 9.3 `VerificationResult`

`verification_agent` 应该输出机器可判定的验真结果：

```ts
interface VerificationResult {
  verification_id: string;
  target_ref: string;
  passed: boolean;
  checks: Array<{
    name: string;
    passed: boolean;
    detail: string;
  }>;
  missing_items: string[];
  retry_candidates: string[];
}
```

### 9.4 `MergeBundle`

`merge_agent` 需要输出能直接交给下游消费的归并结果：

```ts
interface MergeBundle {
  merge_id: string;
  input_refs: string[];
  merged_items: Array<Record<string, unknown>>;
  duplicate_groups: string[][];
  conflicts: Array<{
    item_key: string;
    reason: string;
  }>;
}
```

### 9.5 `ReviewDirective`

`reviewer_agent` 不应该只写评论，而应该产出能真正作用于 runtime 的指令：

```ts
interface ReviewDirective {
  decision: "continue" | "retry" | "reroute" | "fallback";
  reason: string;
  target_ref?: string;
  patch_suggestion?: Record<string, unknown>;
}
```

typed protocol 的目的不是把系统变成全 JSON，而是让 runtime 真正知道：

- 这是一条计划，还是一条动作请求。
- 这是一份中间产物，还是一份最终结果。
- 这是“建议继续”，还是“建议重试”。
- 这是“内容质量不过关”，还是“文件数量不对”。

如果 subagent library 要长期稳定扩展，注册表里建议增加以下信息：

```ts
interface SubagentDefinitionV2 {
  id: string;
  name: string;
  description: string;
  capability_types: string[];
  execution_boundary: string;
  preferred_task_kinds: string[];
  allowed_tools: string[];
  output_contract: string;
  primary_artifact_types: string[];
  side_effect_level: "none" | "low" | "medium" | "high";
  requires_runtime_guard: boolean;
  autonomy_level: "basic" | "enhanced" | "full";
}
```

新增这些字段的目的不是“把配置写得更大”，而是让 runtime 能真正知道：

- 这个 agent 到底是干什么的。
- 它应该接什么任务。
- 它会产出什么类型的结果。
- 它是否涉及副作用。
- 它是否需要更强的 policy gate。

## 10. Routing Policy 建议

### 10.1 总原则

- 规划、验证、合并、最终交付，不应该都默认委派。
- 如果任务是 deterministic operator 任务，优先走 operator agent 或 runtime。
- 如果任务本质上是“说清楚”，再走 writer。
- 如果任务本质上是“判断优劣”，再走 analyst 或 reviewer。

### 10.2 推荐的路由策略

- `planning`：默认 `self` 或 `planner_agent` 辅助，最终 plan state 由 controller 维护。
- `research`：优先 `research_agent`，用于 discovery。
- `collection`：优先 `collector_agent`。
- `analysis`：默认 `analyst_agent` 或 `self`，取决于当前上下文是否已经齐备。
- `review`：默认 `reviewer_agent`，但仅做语义 review。
- `verification`：优先 `verification_agent`。
- `merge`：优先 `merge_agent`。
- `writing`：优先 `writer_agent`，但前提是输入材料已齐。
- `browser_ops`：优先 `browser_operator_agent`。
- `terminal_ops`：优先 `terminal_operator_agent`。

### 10.3 什么时候不该委派

以下事情建议固定留在 runtime/controller：

- retry / reroute / fallback / terminate
- checkpoint 写入
- replay / partial rerun 决策
- budget control
- approval gate
- final deterministic artifact assembly

这部分不是 agent library 的能力，而是控制平面的能力。

## 11. 一个典型任务的理想委派链

以“并行下载 20 篇多 agent 并行相关论文”为例，建议链路是：

1. controller 接收目标，并决定并行度与 batch 边界。
2. `planner_agent` 可选参与，只负责检查目标是否清晰、验收标准是否完整。
3. 两个 `collector_agent` 并行执行，每个只负责自己的 10 篇批次。
4. 每个批次完成后，由 `verification_agent` 检查数量、路径、manifest 和去重情况。
5. 如果两个批次都通过，再交给 `merge_agent` 汇总成统一 bundle。
6. 如果需要自然语言总结，再交给 `writer_agent` 生成人类可读报告。
7. 最终交付包是否算完成，由 runtime 根据 manifest 和本地 artifact 做 deterministic 判断。

这里最关键的变化是：

- `research_agent` 不再包办从搜索到最终交付的一切。
- `writer_agent` 不再承担 correctness 责任。
- “并行”不只是两个 agent 同时跑，而是每个 agent 的 scope boundary 和输出合同都明确。

## 12. 与 Runtime Control Plane 的边界

subagent library 再丰富，也不能替代 runtime control plane。

runtime 仍然必须负责：

- `state machine`
- `owner / controller`
- `trajectory`
- `retry`
- `reroute`
- `fallback`
- `terminate`
- `checkpoint`
- `replay`
- `budget control`
- `structured action` 校验
- `human approval`

一个清晰的原则是：

**agent 负责提出和完成局部任务，runtime 负责保证整个系统不会失控。**

如果一个能力的本质是在回答“这一步能不能做、失败后怎么收、最后算不算完成”，那它几乎一定应该在 runtime，而不是在 subagent。

## 13. 分阶段落地建议

### Phase 1

- 保留现有五个 subagent。
- 调整它们的 description、output contract 和 routing 说明。
- 在注册表里补 `execution_boundary`、`preferred_task_kinds`、`primary_artifact_types` 这类字段。

### Phase 2

- 新增 `collector_agent`、`verification_agent`、`merge_agent`。
- 让 routing 层开始识别 `structured_task.kind`。
- 对论文下载、批量抓取、并行 fan-in 这类任务优先走 operator agent。

### Phase 3

- 新增 `browser_operator_agent`、`terminal_operator_agent`。
- 把 Browser Agent 和 Agent Dev 相关任务从通用 agent 中拆出来。
- 对高副作用环境接入更严格的 policy gate。

### Phase 4

- 建立 subagent 级评测。
- 比较不同 agent 在完成率、retry 率、artifact 完整率、budget 消耗上的表现。
- 基于 replay 和 trajectory 做 routing 记忆优化。

## 14. 结论

新的 subagent library 不应该继续沿着“planner、critic、reviewer、manager 越加越多”的方向扩张，而应该往两个方向同时收敛：

- 保留少量基础通用 agent，负责通用认知能力。
- 新增少量执行边界清晰的 operator agent，负责真实工程动作。

这样做的价值不在于角色名字更多，而在于：

- 复杂任务更容易被拆成稳定路径。
- 并行任务更容易做 scope isolation。
- verification 和 merge 有明确落点。
- runtime 可以更好地追踪每个 subagent 的责任边界。

最终目标不是做一个“会聊天的 agent 团队”，而是做一个**可以被 controller 管理、可以被 runtime 追踪、可以被 replay 和验证的 subagent library**。
