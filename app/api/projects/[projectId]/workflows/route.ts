import { NextResponse } from "next/server";

import { runService } from "@/server/api/run-service";

function resolveApiErrorStatus(message: string) {
  if (message.includes("不存在")) {
    return 404;
  }
  if (
    message.includes("不能为空") ||
    message.includes("无效") ||
    message.includes("invalid json") ||
    message.includes("0 到 2")
  ) {
    return 400;
  }
  if (message.includes("UNIQUE constraint failed") || message.includes("已存在")) {
    return 409;
  }
  return 500;
}

export async function GET(_request: Request, { params }: { params: Promise<{ projectId: string }> }) {
  try {
    const { projectId } = await params;
    return NextResponse.json(runService.listProjectWorkflows(projectId));
  } catch (error) {
    const message = error instanceof Error ? error.message : "获取项目工作流列表失败";
    return NextResponse.json({ error: message }, { status: resolveApiErrorStatus(message) });
  }
}

export async function POST(request: Request, { params }: { params: Promise<{ projectId: string }> }) {
  try {
    const { projectId } = await params;
    const body = (await request.json()) as {
      name?: string;
      description?: string;
      templateId?: string;
      templatePresetTaskId?: string;
      agentTemplateId?: string;
    };

    if (body.templateId && body.agentTemplateId) {
      throw new Error("workflowTemplate 与 agentTemplate 不能同时指定");
    }

    const workflowTemplate = body.templateId ? runService.getWorkflowTemplate(body.templateId).workflowTemplate : null;
    const agentTemplate = body.agentTemplateId
      ? runService.listAgentTemplates().agentTemplates.find((item) => item.id === body.agentTemplateId)
      : null;

    if (body.agentTemplateId && !agentTemplate) {
      throw new Error("Agent 模板不存在");
    }
    if (workflowTemplate && !workflowTemplate.enabled) {
      throw new Error("Workflow 模板已禁用，无法用于创建工作流");
    }
    if (body.templatePresetTaskId && !workflowTemplate) {
      throw new Error("只有从 Workflow 模板创建时才能选择预设测试任务");
    }
    const selectedPresetTask = body.templatePresetTaskId
      ? workflowTemplate?.presetTasks?.find((item) => item.id === body.templatePresetTaskId)
      : undefined;
    if (body.templatePresetTaskId && !selectedPresetTask) {
      throw new Error("所选预设测试任务不存在");
    }
    if (agentTemplate && !agentTemplate.enabled) {
      throw new Error("Agent 模板已禁用，无法用于创建工作流");
    }

    const existing = runService.listProjectWorkflows(projectId).workflows.length;
    const name = body.name?.trim()
      || (workflowTemplate ? `${workflowTemplate.name} 实例` : undefined)
      || (agentTemplate ? `${agentTemplate.name} 工作流` : undefined)
      || `工作流 ${existing + 1}`;

    const agentTemplateNode = agentTemplate
      ? [
          {
            id: `node_from_${agentTemplate.id}_${Date.now().toString(36)}`,
            name: agentTemplate.name,
            role: agentTemplate.role,
            taskSummary: agentTemplate.taskSummary || "待分配任务",
            responsibilitySummary:
              agentTemplate.responsibilitySummary ||
              agentTemplate.defaultPrompt ||
              agentTemplate.description ||
              "来自 Agent 模板",
            position: { x: 220, y: 180 },
          },
        ]
      : [];

    const result = runService.saveWorkflow({
      projectId,
      name,
      description: body.description?.trim() || workflowTemplate?.description || agentTemplate?.description || undefined,
      rootTaskInput:
        selectedPresetTask?.input ||
        workflowTemplate?.rootTaskInput ||
        agentTemplate?.taskSummary ||
        agentTemplate?.defaultPrompt ||
        undefined,
      nodes: workflowTemplate?.nodes ?? agentTemplateNode,
      edges: workflowTemplate?.edges ?? [],
      tasks: workflowTemplate?.tasks ?? [],
      versionLabel: workflowTemplate
        ? `模板初始化：${workflowTemplate.name}`
        : agentTemplate
          ? `Agent 模板初始化：${agentTemplate.name}`
          : "初始版本",
    });
    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "创建项目工作流失败";
    return NextResponse.json({ error: message }, { status: resolveApiErrorStatus(message) });
  }
}
