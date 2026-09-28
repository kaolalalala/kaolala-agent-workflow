# Screenshot Guide — README / 展示截图清单

> 适用于 README、项目展示、面试材料与作品集页面。
> 建议统一使用 16:9 或 16:10 窗口比例，优先保留页面标题、主内容区与关键交互元素，避免截到浏览器过多空白或系统任务栏。

---

## 已有截图

这些图片已经存在于 `docs/screenshots/`，README 会直接引用：

- `dashboard.png`
- `workflow-editor.png`
- `node-library.png`
- `inspector-overview.png`
- `inspector-config.png`
- `run-center.png`
- `run-trace.png`
- `prompt-trace.png`
- `node-io.png`
- `agent-dev.png`
- `agent-dev-ide.png`
- `agent-dev-run.png`
- `assets.png`
- `create-workflow.png`
- `global-search.png`

---

## 建议新增截图

下面这些是当前最值得补的截图，按优先级从高到低排序。

### 1. `meta-agent-overview.png`

- 页面：`/meta-agent`
- 作用：展示 Meta-Agent 已经是独立的控制台，而不是一个普通表单页
- 画面建议包含：
  - 页面标题
  - Mission Control
  - Session Center
  - Runtime Signals / 当前会话状态
  - 至少一条真实 session

### 2. `meta-agent-control-plane.png`

- 页面：`/meta-agent`
- 作用：展示控制平面、恢复路径、Replay / Checkpoint 等强 runtime 能力
- 画面建议包含：
  - Control Plane
  - Recovery & Routing
  - Checkpoints & Replay Candidates
  - 当前 owner / state / budget / allowed actions

### 3. `meta-agent-trace.png`

- 页面：`/meta-agent`
- 作用：展示 Todo / Wave / Trace / Issues / Artifacts 的白盒运行视角
- 画面建议包含：
  - Execution Trace
  - 最近 execution logs
  - Todo / wave 信息
  - artifacts 或 issues 面板

### 4. `evaluations-page.png`

- 页面：`/evaluations`
- 作用：展示评测体系已经具备产品化界面
- 画面建议包含：
  - 左侧或顶部的 Suite / Case 列表
  - 一个选中的 Report / Run 详情
  - score / verdict / compare 相关信息

### 5. `run-detail-control-plane.png`

- 页面：`/projects/{projectId}/runs/{runId}`
- 作用：展示运行详情不仅能看 trace，还能看控制信号
- 画面建议包含：
  - Timeline 或顶部运行摘要
  - Runtime Control / Control Plane
  - Checkpoint / Replay / Recovery 信息

### 6. `project-detail.png`

- 页面：`/projects/{projectId}`
- 作用：展示项目不是单列表，而是聚合工作流、运行、文件、Meta-Agent 活动的业务容器
- 画面建议包含：
  - 项目标题
  - Workflow / Runs / Files 摘要
  - Meta-Agent Activity

### 7. `projects-page.png`

- 页面：`/projects`
- 作用：展示平台具备多项目管理能力
- 画面建议包含：
  - 项目搜索 / 筛选
  - 多张项目卡片或项目表格
  - 创建项目入口

### 8. `settings-page.png`

- 页面：`/settings`
- 作用：展示平台级默认模型、凭证、通知体系已经成型
- 画面建议包含：
  - 默认 provider / model / credential
  - 凭证创建区
  - 通知通道列表
  - 项目继承预览（如有）

### 9. `showcase-console.png`

- 页面：`/showcases`
- 作用：展示面向演示 / 面试的独立控制台能力
- 画面建议包含：
  - 左侧场景列表
  - 场景详情
  - Practical Reproduction / Runbook
  - Provision / Launch Real Demo

---

## 截图顺序建议

如果你时间有限，建议按下面顺序补图：

1. `meta-agent-overview.png`
2. `meta-agent-control-plane.png`
3. `evaluations-page.png`
4. `run-detail-control-plane.png`
5. `settings-page.png`
6. `showcase-console.png`
7. `project-detail.png`
8. `projects-page.png`
9. `meta-agent-trace.png`

---

## 截图构图建议

### A. 控制台类页面

适用：
- Meta-Agent
- Evaluations
- Showcase
- Run Detail

建议：
- 保留页面标题和主卡片区
- 一张图尽量只讲一个主题
- 避免把太多窄卡片塞进同一张截图

### B. 平台总览类页面

适用：
- Dashboard
- Projects
- Project Detail
- Run Center

建议：
- 保留列表 + 统计卡片
- 尽量包含能体现“平台化”的多个模块入口

### C. 编辑器 / IDE 类页面

适用：
- Workflow Editor
- Agent Dev IDE

建议：
- 保留左中右结构
- Workflow 编辑器要有画布、节点、检查器
- Agent Dev 要有文件树、代码编辑器、终端

---

## 命名规范建议

统一使用英文小写加短横线，方便 README 与外部文档直接复用：

- `dashboard.png`
- `projects-page.png`
- `project-detail.png`
- `workflow-editor.png`
- `run-center.png`
- `run-detail-control-plane.png`
- `meta-agent-overview.png`
- `meta-agent-control-plane.png`
- `meta-agent-trace.png`
- `evaluations-page.png`
- `agent-dev-ide.png`
- `assets.png`
- `settings-page.png`
- `showcase-console.png`

---

## README 更新建议

当新截图补齐后，建议同步更新 README 的这几个位置：

- `Screenshot Gallery` 增加：
  - Meta-Agent
  - Evaluations
  - Settings
  - Showcase
  - Projects / Project Detail
- `建议补充的高价值截图` 表格中，将“建议”状态改成“已补齐”

