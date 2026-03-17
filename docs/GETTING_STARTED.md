# Getting Started — 快速上手

> 返回 [README](../README.md)

---

## 环境要求

| 依赖 | 版本 |
|------|------|
| Node.js | >= 22.0 (需要内置 `node:sqlite` 支持) |
| npm | >= 10 |
| 操作系统 | Windows / macOS / Linux |

> **注意**: 项目使用 `node:sqlite` 内置模块，需要 Node.js 22+。同时使用 `node-pty` 作为终端后端，Windows 上需要构建工具 (通常随 Node.js 安装)。

---

## 安装

```bash
# 克隆项目
git clone <repo-url>
cd agent-workflow-v0.2

# 安装依赖
npm install
```

---

## 启动开发服务器

```bash
npm run dev
```

默认启动在 `http://localhost:3000`，打开后自动跳转到仪表盘页面。

数据库文件会自动创建在 `.data/` 目录下，无需手动初始化。

---

## 环境变量 (可选)

在项目根目录创建 `.env.local` 文件：

```bash
# 自定义数据库文件路径 (默认: .data/agent_workflow.db)
AGENT_WORKFLOW_DB_FILE=my_database.db
```

---

## 常用命令

```bash
# 开发模式 (Turbopack 热更新)
npm run dev

# 生产构建
npm run build

# 启动生产服务
npm start

# 代码检查
npm run lint

# 运行测试
npm run test
```

---

## 首次使用指南

### 1. 创建项目
- 进入「项目」页面，点击「创建项目」
- 输入项目名称和描述

### 2. 创建工作流
- 在项目详情中点击「新建工作流」
- 选择空白创建或从模板创建

### 3. 编排节点
- 在工作流编辑器中从左侧节点库拖入节点
- 连线建立节点间的任务流
- 点击节点打开右侧检查器，配置 Agent 参数

### 4. 运行工作流
- 点击运行按钮，输入根任务
- 在运行中心查看执行结果和分析

### 5. 使用开发台
- 进入「开发台」，创建工作台
- 绑定本地项目目录或使用平台工作区
- 编写脚本，点击运行，查看结果

---

## 数据存储

所有数据保存在项目的 `.data/` 目录中：

```
.data/
├── agent_workflow.db    # SQLite 数据库
└── workspaces/          # 工作区文件
    └── {workspaceId}/   # 各工作台的文件存储
```

`.data/` 已加入 `.gitignore`，不会被提交到版本控制。
