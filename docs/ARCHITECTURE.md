# Architecture — 技术架构

> 返回 [README](../README.md)

---

## 整体架构

```
┌─────────────────────────────────────────────────┐
│                  Frontend (React 19)            │
│  ┌──────────┐ ┌──────────┐ ┌──────────────────┐ │
│  │ Platform │ │ Workflow │ │    Agent Dev     │ │
│  │  Pages   │ │  Editor  │ │  (Monaco+Term)   │ │
│  └────┬─────┘ └────┬─────┘ └───────┬──────────┘ │
│       │             │               │            │
│  ┌────▼─────────────▼───────────────▼──────────┐ │
│  │         runtime-client.ts (API Adapter)     │ │
│  └─────────────────────┬───────────────────────┘ │
├────────────────────────┼────────────────────────┤
│                  API Layer (Next.js Route Handlers)
│  ┌─────────────────────▼───────────────────────┐ │
│  │    50+ RESTful API Routes (app/api/*)       │ │
│  └─────────────────────┬───────────────────────┘ │
├────────────────────────┼────────────────────────┤
│                  Backend Services               │
│  ┌──────────┐ ┌────────▼─┐ ┌──────────────────┐ │
│  │  Config  │ │   Run    │ │    Workspace     │ │
│  │ Service  │ │ Service  │ │    Service       │ │
│  └────┬─────┘ └────┬─────┘ └───────┬──────────┘ │
│       │             │               │            │
│  ┌────▼─────────────▼───────────────▼──────────┐ │
│  │         Memory Store (Data Access)          │ │
│  └─────────────────────┬───────────────────────┘ │
│  ┌─────────────────────▼───────────────────────┐ │
│  │            SQLite (node:sqlite)             │ │
│  └─────────────────────────────────────────────┘ │
│                                                  │
│  ┌──────────────┐  ┌──────────────┐              │
│  │ LLM Adapter  │  │ Runtime      │              │
│  │ (多 Provider) │  │ Engine       │              │
│  └──────────────┘  └──────────────┘              │
└─────────────────────────────────────────────────┘
```

---

## 分层说明

### 1. 前端层

| 模块 | 位置 | 职责 |
|------|------|------|
| Platform Pages | `app/(platform)/` | 仪表盘、项目、运行中心等页面 |
| Workflow Editor | `src/features/workflow/components/` | 基于 ReactFlow 的节点编辑器 |
| Agent Dev Shell | `app/(platform)/agent-dev/` | Monaco + XTerm IDE 环境 |
| State Management | `src/features/workflow/store/` | Zustand store |
| API Client | `src/features/workflow/adapters/runtime-client.ts` | 前后端数据适配 |
| UI Kit | `src/components/ui/` | Button / Card / Input / Tabs 等基础组件 |

### 2. API 层

所有后端接口通过 Next.js Route Handlers 暴露，位于 `app/api/`。

主要 API 分组：
- `/api/projects` — 项目 CRUD
- `/api/runs` — 运行管理与分析
- `/api/assets/*` — 资产管理 (模型/工具/Prompt/Skill)
- `/api/workspace/*` — 工作区文件操作与执行
- `/api/agent-dev/*` — 开发台 API
- `/api/workflow-templates` — 工作流模板
- `/api/credentials` — 凭证管理

### 3. 服务层

| 服务 | 文件 | 职责 |
|------|------|------|
| RunService | `src/server/api/run-service.ts` | 运行 / 项目 / 工作流 / 文件的核心业务逻辑 |
| ConfigService | `src/server/config/config-service.ts` | 配置管理、模板、分析查询 |
| WorkspaceService | `src/server/workspace/workspace-service.ts` | 工作区文件管理 |
| MemoryStore | `src/server/store/memory-store.ts` | 数据访问层 (SQLite 查询封装) |

### 4. 持久化层

- **SQLite** — 使用 Node.js 内置 `node:sqlite` 的 `DatabaseSync`
- 自动迁移 — `hasColumn()` / `safeAlter()` 模式，零手动迁移
- 数据目录 — `.data/` (默认) 或 `AGENT_WORKFLOW_DB_FILE` 环境变量

主要表：
```
projects / workflows / workflow_edges
run_snapshot / run_events / run_node_io / run_traces
dev_run_detail
agent_node_config / agent_documents
tool_definitions / tool_bindings / skill_bindings
secret_credentials / notifications
local_project_config
```

### 5. 执行引擎

- **Runtime Engine** — 工作流执行编排，按拓扑顺序驱动节点
- **LLM Chat Adapter** — 多 Provider 支持 (OpenAI / Claude / 自定义)，带 Trace 采集
- **Dev Agent Executor** — 脚本执行引擎，安全白名单限制命令

---

## 关键设计决策

### 单体架构 (Monolith)
前后端、数据库集成在单个 Next.js 应用中，零外部依赖启动。适合个人/小团队的 Agent 开发场景。

### SQLite 轻量持久化
无需 PostgreSQL / MySQL 等外部数据库。文件级数据库，项目随拷即用。通过 `DatabaseSync` 同步 API 简化代码。

### 前后端类型共享
`runtime-client.ts` 作为唯一的前后端桥梁，统一类型转换。前端不直接依赖后端 domain 类型。

### 运行类型区分
`run_snapshot.run_type` 列区分 `workflow_run` 和 `dev_run`，统一存储、独立展示。

---

## 数据流

```
用户操作
  → React 组件 (event handler)
    → Zustand Store (状态更新) + runtime-client (API 调用)
      → Next.js API Route
        → Service Layer (业务逻辑)
          → Memory Store (数据查询)
            → SQLite (持久化)
```

工作流执行流：
```
用户点击"运行"
  → POST /api/runs/:runId/start
    → Runtime Engine 启动
      → 按拓扑排序遍历节点
        → LLM Adapter / Dev Agent Executor 执行
          → 写入 run_events / run_traces / run_node_io
            → SSE 实时推送事件到前端
```
