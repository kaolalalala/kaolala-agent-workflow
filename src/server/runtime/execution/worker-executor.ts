import { ExecutorResult } from "@/server/runtime/execution/types";

export function workerExecutor(taskBrief: string, summarizerNodeId: string): ExecutorResult {
  const result = `中间结果:\n已根据任务书完成调研，识别出多代理协作的典型模式、适用场景与关键权衡。\n输入摘要:\n${taskBrief}`;

  return {
    latestOutput: "已完成中间结果并发送给总结代理。",
    outboundMessages: [
      {
        toNodeId: summarizerNodeId,
        type: "result",
        content: result,
      },
    ],
  };
}
