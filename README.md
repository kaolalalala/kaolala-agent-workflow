# Agent Workflow Platform v0.2

**可视化多智能体工作流编排与执行平台**

一个基于 Next.js 构建的全栈平台，用于设计、执行、监控和调试多 Agent 工作流。通过可视化节点编辑器编排智能体协作流程，配合运行中心、执行追踪和分析看板，实现对 AI Agent 全生命周期的管理。

---

## Screenshots

### 仪表盘 & 项目管理

![Dashboard](docs/screenshots/dashboard.png)

### 工作流编辑器

![Workflow Editor](docs/screenshots/workflow-editor.png)

<details>
<summary>节点库 & 节点检查器</summary>

| 节点库 | 检查器 - 概览 | 检查器 - 配置 |
|--------|--------------|--------------|
| ![Node Library](docs/screenshots/node-library.png) | ![Inspector Overview](docs/screenshots/inspector-overview.png) | ![Inspector Config](docs/screenshots/inspector-config.png) |

</details>

### 运行中心 & 分析看板

![Run Center](docs/screenshots/run-center.png)

### 执行追踪 & 调试

![Execution Timeline](docs/screenshots/run-trace.png)

<details>
<summary>Prompt Trace & 节点 I/O</summary>

| Prompt Trace | 节点 I/O |
|-------------|----------|
| ![Prompt Trace](docs/screenshots/prompt-trace.png) | ![Node IO](docs/screenshots/node-io.png) |

</details>

### 开发台 (Agent Dev)

| 工作台列表 | IDE 环境 |
|-----------|---------|
| ![Agent Dev](docs/screenshots/agent-dev.png) | ![Agent Dev IDE](docs/screenshots/agent-dev-ide.png) |

![运行脚本](docs/screenshots/agent-dev-run.png)

### 资产管理 & 全局功能

| 资产管理 | 创建工作流 | 全局搜索 |
|---------|-----------|---------|
| ![Assets](docs/screenshots/assets.png) | ![Create Workflow](docs/screenshots/create-workflow.png) | ![Global Search](docs/screenshots/global-search.png) |

---

## What's New

### v0.2.2 — Meta-Agent 自进化引擎 (2026-03-23)

**Meta-Agent — 自规划、自评估、自进化的 Agent 系统**

平台不再只是跑 Agent 的工具，而是一个**能自主思考和进化的 Agent 系统**。

- **自规划 (Self-Planning)** — 输入高层目标，Meta-Agent 自动设计工作流拓扑（选择节点角色、连线、分配职责）
- **自执行 (Self-Execution)** — 调用平台自身的 Runtime Engine 运行工作流，复用全部已有基础设施
- **自观测 (Self-Observation)** — 读取 Execution Trace、Node I/O、Token 统计，全面了解执行状况
- **自评估 (Self-Reflection)** — LLM 对输出质量评分，判断是否达到目标，给出改进反馈
- **自进化 (Self-Evolution)** — 根据评估反馈自动修改 Prompt、拓扑结构、工具绑定，迭代优化直到达标

```
用户给出目标 → Meta-Agent 规划工作流 → 执行 → 观测追踪 → 反思评分
                    ↑                                          ↓
                    └──────── 未达标：自动调整策略，重新规划 ←───┘
```

- 独立页面 `/meta-agent`：输入目标、设置迭代次数和质量阈值、查看完整迭代过程
- 完整的工作流进化历程可视化：每轮的拓扑变化、评分、调整策略

---

### v0.2.1 — Runtime & Memory 增强 (2026-03-23)

**执行引擎升级**
- **Durable Scheduler** — 基于 checkpoint 的 DAG 调度器，支持运行中断后恢复
- **Agent Registry** — 能力注册表，支持基于能力的 Agent 查找与动态 Handoff
- **Built-in Agent Tools** — 运行时内置工具（由引擎拦截处理，非外部工具调用）
- **Reflection** — Agent 输出自评估与迭代改进机制
- **Circuit Breaker** — 熔断器，防止外部服务故障时的级联崩溃
- **Retry** — 指数退避 + 抖动的自动重试，区分暂时性/永久性错误
- **Token Budget** — Run/Node 级别的 Token 预算追踪与限制

**记忆系统**
- **Working Memory** — Token 预算感知的动态上下文装配，替代固定拼接
- **Memory Consolidation** — 相似记忆合并与衰减机制
- **Embedding Service** — 向量嵌入服务（兼容 OpenAI Embeddings API）
- **Long-term Memory** 增强 — 支持向量检索与语义相似度

**评估系统 (Evaluation)**
- 新增评估模块：Suite / Case / Run 三层结构
- 评估页面与 API（`/evaluations`）
- 支持批量评估与结果对比

**通知系统 (Notification Channels)**
- 运行完成/失败时自动推送通知
- 6 种通道适配器：飞书、钉钉、Slack、Discord、通用 Webhook、SMTP 邮件
- 设置页面可视化管理：添加/删除/启用禁用/测试发送
- 配置加密存储（AES-256-GCM），投递日志记录

**其他**
- Layout 全面升级，新增评估入口
- RightInspector 配置面板优化
- LLM Adapter 增强：支持更多 Provider 特性
- Output Manager：运行产物统一管理

> 完整变更记录: [docs/CHANGELOG_CN_v0_2.md](docs/CHANGELOG_CN_v0_2.md)

---

## Features

平台涵盖从项目管理到智能体开发的完整工具链：

- **Meta-Agent** — 自规划、自评估、自进化的 Agent 系统，输入目标自动设计并迭代优化工作流
- **可视化工作流编辑器** — 拖拽式节点画布，支持 8 种智能体角色节点的编排与连接（并且也支持自定义）
- **运行中心 & 分析看板** — 工作流运行/开发运行双视角，趋势图、成功率、Token 用量等多维图表
- **执行追踪 & 调试** — 执行时间线、节点 I/O 检查、Prompt Trace、Tool Call Trace
- **开发台 (Agent Dev)** — 集成 Monaco 编辑器 + 终端的 IDE 环境，直接运行脚本并追踪
- **资产管理** — 模型、Prompt 模板、工具、技能包、参考文档的统一管理
- **项目管理** — 项目 CRUD、归档、工作流版本管理、全局搜索
- **通知推送** — 运行完成/失败自动通知，支持飞书、钉钉、Slack、Discord、Webhook、邮件

> 详细功能说明: [docs/FEATURES.md](docs/FEATURES.md)

---

## Tech Stack

| 层 | 技术 |
|----|------|
| 框架 | Next.js 16 (App Router) + React 19 + TypeScript 5 |
| 状态管理 | Zustand |
| 可视化 | ReactFlow (节点画布) + Recharts (图表) |
| 代码编辑 | Monaco Editor |
| 终端 | XTerm.js + node-pty |
| UI | Tailwind CSS 4 + Radix UI + Lucide Icons |
| 数据库 | SQLite (`node:sqlite`) |
| 构建 | Turbopack (开发) / Next.js Build (生产) |

> 完整技术架构: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)

---

## Quick Start

```bash
# 克隆项目
git clone <repo-url>
cd agent-workflow-v0.2

# 安装依赖
npm install

# 启动开发服务器
npm run dev
```

打开 [http://localhost:3000](http://localhost:3000)，自动跳转到仪表盘。

```bash
# 质量校验
npm run lint
npm run test
npm run build
```

> 详细配置说明: [docs/GETTING_STARTED.md](docs/GETTING_STARTED.md)

---

## Project Structure

```
├── app/
│   ├── (platform)/          # 平台页面 (仪表盘/项目/运行/开发台/资产/设置)
│   └── api/                 # RESTful API 路由 (50+ 端点)
├── src/
│   ├── features/workflow/   # 工作流编辑器 (画布/检查器/状态管理/API 客户端)
│   ├── components/          # 通用 UI 组件 + 终端组件
│   ├── server/
│   │   ├── domain/          # 领域模型 (15 个实体定义)
│   │   ├── persistence/     # SQLite 持久化层
│   │   ├── api/             # 后端服务层
│   │   ├── agents/          # LLM 适配器 (多 Provider 支持)
│   │   ├── runtime/         # 工作流执行引擎
│   │   ├── config/          # 配置 & 内置模板
│   │   └── tools/           # 工具执行 & 绑定
│   └── lib/                 # 工具函数
├── docs/                    # 项目文档
└── .data/                   # SQLite 数据库 & 工作区文件 (运行时生成)
```

---

## Documentation

| 文档 | 说明 |
|------|------|
| [Features](docs/FEATURES.md) | 核心功能模块详解 |
| [Architecture](docs/ARCHITECTURE.md) | 技术架构与设计决策 |
| [Getting Started](docs/GETTING_STARTED.md) | 安装、配置、环境要求 |
| [Changelog](docs/CHANGELOG_CN_v0_2.md) | v0.2 变更日志 |

---

## Known Limitations

- 账号与权限系统为占位状态，尚未实现多用户隔离
- 通知系统为最小可用版本，不含推送机制
- 分布式部署暂不支持（当前为单机 SQLite 架构）
- 运行对比 (Run Compare) 仅提供基础 API，前端可视化待完善

---

## 密语

大家可以自由地参与改进这个项目 🙌  
目前已经具备了一些基础功能，但整体深度和完整性还有很大的提升空间。  
如果你觉得这个项目对你有帮助，或者打算拿去使用的话，欢迎点个 ⭐ 支持一下～爱你们呦！  
这对正在找相关方向实习的我来说真的非常重要，感谢大家！  
如果在使用过程中遇到任何问题，或者有改进建议，欢迎随时提 issue，我会尽快跟进修复和优化。  
如果后续使用的人多了，也会考虑建一个交流群方便大家一起讨论。  
这个项目最初是想复刻类似 ComfyUI 的 workflow 形态，但在实现过程中逐渐发现还有很多细节和能力需要补齐。  
后面也会持续迭代，在可扩展性、稳定性以及整体设计上进一步完善。  

---

## License

MIT
