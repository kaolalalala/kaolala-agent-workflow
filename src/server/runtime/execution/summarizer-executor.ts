import { ExecutorResult } from "@/server/runtime/execution/types";

export function summarizerExecutor(workerResult: string): ExecutorResult {
  const finalText = `最终总结:\n1. 协作链路清晰可追踪。\n2. 角色分工明确可扩展。\n3. 事件驱动模型可支撑实时可观察。\n\n汇总依据:\n${workerResult}`;

  return {
    latestOutput: "已生成最终总结。",
    finalOutput: finalText,
  };
}
