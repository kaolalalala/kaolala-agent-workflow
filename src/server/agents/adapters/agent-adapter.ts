import { AgentExecutionInput, AgentExecutionOutput } from "@/server/agents/types";

export interface AgentAdapter {
  run(input: AgentExecutionInput): Promise<AgentExecutionOutput>;
}
