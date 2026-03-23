import { AgentExecutionInput } from "@/server/agents/types";

export interface BuiltPrompt {
  system: string;
  user: string;
}

function describeInboundMessage(message: AgentExecutionInput["context"]["inboundMessages"][number]) {
  const payloadData = message.payload?.data;
  const userInput = typeof payloadData?.userInput === "string" ? payloadData.userInput : undefined;
  const humanMessage = typeof payloadData?.humanMessage === "string" ? payloadData.humanMessage : undefined;
  const task = typeof payloadData?.task === "string" ? payloadData.task : undefined;
  return userInput || humanMessage || task || message.content;
}

export function buildPrompt(input: AgentExecutionInput): BuiltPrompt {
  const humanLines = input.context.humanMessages.length
    ? input.context.humanMessages.map((m) => `- ${m.content}`).join("\n")
    : "- 无";

  const inboundLines = input.context.inboundMessages.length
    ? input.context.inboundMessages.map((m) => `- (${m.type}) ${describeInboundMessage(m)}`).join("\n")
    : "- 无";

  const outputs = input.context.recentOutputs.length ? input.context.recentOutputs.map((o) => `- ${o}`).join("\n") : "- 无";

  return {
    system: input.definition.systemPrompt,
    user: [
      `最终执行输入:\n${input.resolvedInput || "无"}`,
      `任务书: ${input.context.taskBrief ?? "无"}`,
      `上游消息:\n${inboundLines}`,
      `人工消息:\n${humanLines}`,
      `近期输出:\n${outputs}`,
    ].join("\n\n"),
  };
}
