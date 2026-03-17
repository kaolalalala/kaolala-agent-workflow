import { ExecutorResult } from "@/server/runtime/execution/types";

export function plannerExecutor(inputTask: string, workerNodeId: string): ExecutorResult {
  const brief = `任务书:\n目标: ${inputTask}\n步骤: 1) 收集协作模式 2) 提炼关键差异 3) 形成对比摘要`;

  return {
    latestOutput: "已生成执行任务书并分配给执行代理。",
    outboundMessages: [
      {
        toNodeId: workerNodeId,
        type: "task_assignment",
        content: brief,
      },
    ],
  };
}
