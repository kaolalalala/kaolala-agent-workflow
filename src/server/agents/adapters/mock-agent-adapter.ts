import { AgentAdapter } from "@/server/agents/adapters/agent-adapter";
import { AgentExecutionInput, AgentExecutionOutput } from "@/server/agents/types";

function parseToolDirective(content?: string) {
  if (!content) {
    return null;
  }
  const match = content.match(/^\/tool\s+([a-zA-Z0-9:_-]+)(?:\s+(.+))?$/);
  if (!match) {
    return null;
  }

  let parsedInput: Record<string, unknown> = {};
  if (match[2]) {
    try {
      parsedInput = JSON.parse(match[2]) as Record<string, unknown>;
    } catch {
      parsedInput = { raw: match[2] };
    }
  }

  return { toolId: match[1], input: parsedInput };
}

function describeInbound(input: AgentExecutionInput) {
  const latest = input.context.inboundMessages.at(-1);
  if (!latest) {
    return "";
  }

  const payloadData = latest.payload?.data ?? {};
  const userInput = typeof payloadData.userInput === "string" ? payloadData.userInput.trim() : "";
  const humanMessage = typeof payloadData.humanMessage === "string" ? payloadData.humanMessage.trim() : "";
  const task = typeof payloadData.task === "string" ? payloadData.task.trim() : "";
  const content = latest.content?.trim() ?? "";

  return userInput || humanMessage || task || content;
}

function describeAttachments(input: AgentExecutionInput) {
  const latestHuman = input.context.humanMessages.at(-1);
  if (!latestHuman?.attachments?.length) {
    return "";
  }
  return latestHuman.attachments.map((item) => `${item.name}(${item.mimeType})`).join(", ");
}

export class MockAgentAdapter implements AgentAdapter {
  async run(input: AgentExecutionInput): Promise<AgentExecutionOutput> {
    const latestHuman = input.context.humanMessages.at(-1)?.content?.trim() ?? "";
    const resolved = input.resolvedInput?.trim() ?? "";
    const inbound = describeInbound(input);
    const attachmentHint = describeAttachments(input);
    const toolDirective = parseToolDirective(latestHuman) || parseToolDirective(resolved);

    if (input.node.role === "planner") {
      const assignment = [
        `Task brief: ${input.context.taskBrief ?? "N/A"}`,
        inbound ? `Upstream input: ${inbound}` : "",
        latestHuman ? `Human instruction: ${latestHuman}` : "",
        attachmentHint ? `Attachments: ${attachmentHint}` : "",
      ]
        .filter(Boolean)
        .join("\n");

      return {
        latestOutput: "Planner generated assignment from current context.",
        outboundMessages: [
          {
            toNodeId: "",
            type: "task_assignment",
            content: assignment || resolved || "No assignment content available.",
          },
        ],
      };
    }

    if (
      input.node.role === "worker" ||
      input.node.role === "research" ||
      input.node.role === "reviewer" ||
      input.node.role === "tool"
    ) {
      let toolHint = "";
      if (toolDirective) {
        const result = await input.invokeTool({
          toolId: toolDirective.toolId,
          input: toolDirective.input,
        });
        toolHint = result.ok
          ? `Tool result: ${JSON.stringify(result.data ?? {})}`
          : `Tool error: ${result.error?.message ?? "Unknown tool error"}`;
      }

      const output = [
        "Worker processed the request using resolved context.",
        inbound ? `Inbound: ${inbound}` : "",
        latestHuman ? `Human override: ${latestHuman}` : "",
        attachmentHint ? `Attachments: ${attachmentHint}` : "",
        toolHint,
      ]
        .filter(Boolean)
        .join("\n");

      return {
        latestOutput: "Worker produced intermediate output.",
        outboundMessages: [
          {
            toNodeId: "",
            type: "result",
            content: output || resolved || "No worker output generated.",
          },
        ],
      };
    }

    if (input.node.role === "router") {
      const routingSource = [latestHuman, inbound, resolved]
        .filter(Boolean)
        .join("\n")
        .toLowerCase();

      const condition = routingSource.includes("reject") || routingSource.includes("拒绝")
        ? "reject"
        : routingSource.includes("approve") || routingSource.includes("通过")
          ? "approve"
          : routingSource.includes("research") || routingSource.includes("调研")
            ? "research"
            : routingSource.includes("summary") || routingSource.includes("总结")
              ? "summary"
              : "default";

      return {
        latestOutput: `Router selected branch: ${condition}`,
        outboundMessages: [
          {
            toNodeId: "",
            type: input.context.inboundMessages.at(-1)?.type ?? "task_assignment",
            content: resolved || inbound || latestHuman || "Router forwarded current context.",
          },
        ],
        condition,
      };
    }

    let saveHint = "";
    if (toolDirective && input.node.role === "summarizer") {
      const saveInput =
        toolDirective.input && Object.keys(toolDirective.input).length > 0
          ? {
              ...toolDirective.input,
              content:
                typeof toolDirective.input.content === "string" && toolDirective.input.content.trim()
                  ? toolDirective.input.content
                  : resolved || inbound || latestHuman || "No content",
            }
          : {
              path: "./output/agent-os-latest.md",
              content: resolved || inbound || latestHuman || "No content",
            };
      const result = await input.invokeTool({
        toolId: toolDirective.toolId,
        input: saveInput,
      });
      saveHint = result.ok
        ? `Save result: ${JSON.stringify(result.data ?? {})}`
        : `Save error: ${result.error?.message ?? "Unknown tool error"}`;
    }

    const finalOutput = [
      "Final summary generated from upstream and resolved input.",
      inbound ? `Inbound: ${inbound}` : "",
      latestHuman ? `Human note: ${latestHuman}` : "",
      resolved ? `Resolved input excerpt: ${resolved.slice(0, 1000)}` : "",
      saveHint,
    ]
      .filter(Boolean)
      .join("\n");

    return {
      latestOutput: "Summarizer produced final output.",
      finalOutput,
    };
  }
}
