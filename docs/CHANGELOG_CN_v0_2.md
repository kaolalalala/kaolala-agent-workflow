# 变更记录（v0.2）

## 2026-03-15（最新）

### 运行中心第二阶段（运行分析与图表化）
- 新增运行分析 API：`GET /api/runs/analytics?days=7|30`
- 运行中心页面新增图表分析区：
  - 运行趋势（折线图）
  - 成功率分布（饼图）
  - 工作流 Token 使用（柱状图）
  - 节点耗时排行（横向柱图）
  - 节点失败率排行（柱状图）
- 顶部统计卡片增强：总运行数、成功率、平均耗时、Token 总量
- 图表库引入：`recharts`

### 运行调试系统（Execution Trace）
- Run Detail 新增 Execution Timeline（节点级时间线）
- Run Detail 新增节点调试面板：
  - Node Input / Node Output
  - Prompt Trace（System/User/History/Completion/Token）
  - Tool Call Trace（输入、输出、耗时、错误）
- 新增后端 trace 数据结构：
  - `executionTimeline`
  - `nodeTraces`
  - `replayHints`（重放能力预留）
- 运行时事件增强：
  - 工具调用事件写入 `input/output/toolName`
  - LLM 生命周期事件写入 `promptTrace/completion`

### 稳定性与兼容修复
- 修复 LLM 非流式路径生命周期事件顺序问题，避免 `llm_response_received` 丢失
- 保持既有主链路不破坏（项目、工作流、运行、文件、模板、资产）

### 验证
- `npm run lint`：通过
- `npm run test`：通过（52 passed）
- `npm run build`：通过

---

## 历史阶段（摘要）

### v0.2 初始阶段
- 平台骨架：Dashboard / Projects / Assets / Settings
- Project -> Workflow 主链路打通
- Run / File 基础闭环打通
- Workflow Template 进入主流程
- 全局搜索、通知、右上角全局入口产品化

### v0.1 阶段
- 平台化雏形、编辑器基础集成、基础运行能力

