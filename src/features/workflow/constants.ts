import { AgentRole, EventType, NodeStatus, RunStatus } from "@/features/workflow/types";

export const ROLE_LABELS: Record<AgentRole, string> = {
  planner: "规划代理",
  worker: "执行代理",
  research: "研究代理",
  reviewer: "审阅代理",
  summarizer: "总结代理",
  router: "路由节点",
  human: "人工输入节点",
  tool: "工具节点",
  input: "输入节点",
  output: "输出节点",
};

export const ROLE_RESPONSIBILITY: Record<AgentRole, string> = {
  planner: "负责任务拆解与执行路径规划。",
  worker: "负责执行具体子任务并回传结果。",
  research: "负责检索信息、证据与材料整理。",
  reviewer: "负责检查内容质量与风险点。",
  summarizer: "负责汇总多节点结果并产出最终输出。",
  router: "根据上游输出内容，决定激活哪条下游分支。",
  human: "接收人工文本或文件输入，并传递给后续节点。",
  tool: "用于调用外部工具或系统能力。",
  input: "端口节点：接收任务输入并注入工作流。",
  output: "端口节点：收集上游结果并输出最终结果。",
};

export const STATUS_LABELS: Record<NodeStatus, string> = {
  idle: "空闲",
  ready: "就绪",
  running: "运行中",
  waiting: "等待中",
  completed: "已完成",
  failed: "失败",
};

export const STATUS_STYLES: Record<NodeStatus, string> = {
  idle: "bg-slate-200 text-slate-700 border-slate-300 dark:bg-slate-800 dark:text-slate-200 dark:border-slate-600",
  ready: "bg-cyan-100 text-cyan-700 border-cyan-300 dark:bg-cyan-500/20 dark:text-cyan-200 dark:border-cyan-500/40",
  running: "bg-blue-100 text-blue-700 border-blue-300 dark:bg-blue-500/20 dark:text-blue-200 dark:border-blue-500/40",
  waiting: "bg-amber-100 text-amber-700 border-amber-300 dark:bg-amber-500/20 dark:text-amber-200 dark:border-amber-500/40",
  completed:
    "bg-emerald-100 text-emerald-700 border-emerald-300 dark:bg-emerald-500/20 dark:text-emerald-200 dark:border-emerald-500/40",
  failed: "bg-rose-100 text-rose-700 border-rose-300 dark:bg-rose-500/20 dark:text-rose-200 dark:border-rose-500/40",
};

export const NODE_LIBRARY_ROLES: Array<{ role: AgentRole; disabled?: boolean }> = [
  { role: "input" },
  { role: "planner" },
  { role: "worker" },
  { role: "research" },
  { role: "reviewer" },
  { role: "summarizer" },
  { role: "router" },
  { role: "output" },
  { role: "tool", disabled: true },
  { role: "human", disabled: true },
];

export const RUN_STATUS_LABELS: Record<RunStatus, string> = {
  idle: "空闲",
  running: "运行中",
  completed: "已完成",
  failed: "失败",
  cancelled: "已取消",
};

export const EVENT_TYPE_LABELS: Record<EventType, string> = {
  edge_connected: "连线已连接",
  edge_deleted: "连线已删除",
  output_generated: "最终输出已生成",
  run_created: "运行已创建",
  run_started: "运行已启动",
  task_created: "任务已创建",
  node_created: "节点已创建",
  edge_created: "连线已创建",
  node_ready: "节点已就绪",
  node_waiting: "节点等待中",
  task_assigned: "任务已分配",
  node_started: "节点开始执行",
  execution_phase_changed: "执行阶段已切换",
  message_sent: "消息已发送",
  message_delivered: "消息已送达",
  context_resolved: "上下文已解析",
  node_completed: "节点已完成",
  node_failed: "节点执行失败",
  run_completed: "运行已完成",
  run_failed: "运行失败",
  human_message_sent: "人工消息已发送",
  node_rerun_requested: "已请求节点重跑",
  node_rerun_started: "节点重跑开始",
  downstream_rerun_started: "下游重跑开始",
  agent_context_updated: "节点上下文已更新",
  llm_request_sent: "模型请求已发送",
  llm_response_received: "模型响应已返回",
  tool_invocation_started: "工具调用开始",
  tool_invocation_succeeded: "工具调用成功",
  tool_invocation_failed: "工具调用失败",
  token_stream: "流式输出中",
  loop_iteration: "循环迭代",
  loop_converged: "循环收敛",
};
