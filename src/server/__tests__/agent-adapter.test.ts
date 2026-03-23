import { afterEach, describe, expect, it, vi } from "vitest";

import { LLMChatAdapter } from "@/server/agents/adapters/llm-chat-adapter";
import { MockAgentAdapter } from "@/server/agents/adapters/mock-agent-adapter";
import { buildPrompt } from "@/server/agents/builder/prompt-builder";
import type { AgentExecutionInput } from "@/server/agents/types";
import type { ResolvedTool } from "@/server/tools/contracts";

function buildWorkerInput(humanMessage?: string): AgentExecutionInput {
  return {
    node: {
      id: "node_worker",
      runId: "run_1",
      name: "Worker-1",
      role: "worker",
      status: "running",
      inboundMessages: [],
      outboundMessages: [],
      resolvedInput: "",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      agentDefinitionId: "agent_def_worker",
      contextId: "agent_ctx_worker",
    },
    definition: {
      id: "agent_def_worker",
      runId: "run_1",
      name: "Worker",
      role: "worker",
      systemPrompt: "You are the worker.",
      responsibility: "Execute assigned task",
      allowHumanInput: true,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    },
    context: {
      id: "agent_ctx_worker",
      nodeId: "node_worker",
      runId: "run_1",
      systemPrompt: "You are the worker.",
      taskBrief: "Analyze collaboration patterns",
      inboundMessages: [
        {
          id: "msg_1",
          runId: "run_1",
          fromNodeId: "node_planner",
          toNodeId: "node_worker",
          type: "task_assignment",
          content: "Please compare approaches.",
          createdAt: new Date().toISOString(),
        },
      ],
      outboundMessages: [],
      resolvedInput: "test input",
      humanMessages: humanMessage
        ? [
            {
              id: "hm_1",
              runId: "run_1",
              targetNodeId: "node_worker",
              content: humanMessage,
              createdAt: new Date().toISOString(),
            },
          ]
        : [],
      recentOutputs: [],
      updatedAt: new Date().toISOString(),
    },
    resolvedInput: "test input",
    availableTools: [],
    invokeTool: async () => ({
      ok: false,
      durationMs: 0,
      error: {
        code: "TOOL_NOT_AVAILABLE",
        message: "no tool",
        retriable: false,
        source: "platform",
      },
    }),
  };
}

describe("agent adapter", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("mock worker output changes when human message exists", async () => {
    const adapter = new MockAgentAdapter();

    const withoutHuman = await adapter.run(buildWorkerInput());
    const withHuman = await adapter.run(buildWorkerInput("Please add concrete examples."));

    expect(withoutHuman.outboundMessages?.[0]?.content).not.toBe(withHuman.outboundMessages?.[0]?.content);
    expect(withHuman.outboundMessages?.[0]?.content).toContain("Human override");
  });

  it("prompt builder includes human and inbound messages", () => {
    const built = buildPrompt(buildWorkerInput("Focus on Dynamic Agent Creation"));

    expect(built.system).toContain("worker");
    expect(built.user).toContain("最终执行输入");
    expect(built.user).toContain("上游消息");
    expect(built.user).toContain("人工消息");
    expect(built.user).toContain("Dynamic Agent Creation");
  });

  it("llm adapter auto-calls tool and continues completion", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            choices: [
              {
                message: {
                  role: "assistant",
                  content: "",
                  tool_calls: [
                    {
                      id: "call_1",
                      type: "function",
                      function: {
                        name: "weather_lookup_0",
                        arguments: "{\"city\":\"Shanghai\"}",
                      },
                    },
                  ],
                },
              },
            ],
          }),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            choices: [
              {
                message: {
                  role: "assistant",
                  content: "Final answer: Shanghai is sunny today.",
                },
              },
            ],
          }),
          { status: 200 },
        ),
      );

    const invokeTool = vi.fn().mockResolvedValue({
      ok: true,
      durationMs: 12,
      data: { weather: "sunny" },
      meta: { provider: "mock" },
    });

    const availableTools: ResolvedTool[] = [
      {
        toolId: "weather.lookup",
        name: "Weather Lookup",
        description: "Return weather by city",
        category: "retrieval",
        inputSchema: {
          type: "object",
          properties: {
            city: { type: "string" },
          },
          required: ["city"],
        },
        outputSchema: {
          type: "object",
          properties: {
            weather: { type: "string" },
          },
        },
        sourceType: "http_api",
        sourceConfig: {},
        authRequirements: { type: "none", required: false },
        policy: {},
        enabled: true,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        effectiveEnabled: true,
        effectivePriority: 0,
        resolvedFrom: "platform_pool",
        effectiveConfig: {},
      },
    ];

    const adapter = new LLMChatAdapter({
      baseURL: "https://example.com/v1",
      apiKey: "test-key",
      model: "gpt-4o-mini",
    });

    const result = await adapter.run({
      ...buildWorkerInput("Check Shanghai weather"),
      availableTools,
      invokeTool,
    });

    expect(result.latestOutput).toContain("Final answer");
    expect(invokeTool).toHaveBeenCalledWith({
      toolId: "weather.lookup",
      input: { city: "Shanghai" },
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);

    const firstCallBody = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body));
    expect(firstCallBody.tools).toBeDefined();
    expect(firstCallBody.tool_choice).toBe("auto");

    const secondCallBody = JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body));
    expect(secondCallBody.messages.some((message: { role: string }) => message.role === "tool")).toBe(true);
  });
});
