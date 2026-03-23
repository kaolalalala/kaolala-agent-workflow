import { NextResponse } from "next/server";

import { runService } from "@/server/api/run-service";

export async function GET(request?: Request) {
  try {
    const projectId = request ? new URL(request.url).searchParams.get("projectId") ?? undefined : undefined;
    if (projectId) {
      return NextResponse.json(runService.listProjectWorkflows(projectId));
    }
    return NextResponse.json(runService.listWorkflows());
  } catch (error) {
    const message = error instanceof Error ? error.message : "查询工作流列表失败";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
      workflowId?: string;
      projectId?: string;
      name?: string;
      description?: string;
      rootTaskInput?: string;
      versionLabel?: string;
      versionNotes?: string;
      nodes?: Array<{
        id: string;
        name: string;
        role: string;
        status?: string;
        taskSummary?: string;
        responsibilitySummary?: string;
        position?: { x: number; y: number };
        width?: number;
        height?: number;
      }>;
      edges?: Array<{
        id: string;
        sourceNodeId: string;
        targetNodeId: string;
        type: "task_flow" | "output_flow";
        condition?: string;
      }>;
      tasks?: Array<{
        id: string;
        title: string;
        status: string;
        parentTaskId?: string;
        assignedNodeId?: string;
        summary?: string;
      }>;
    };

    const result = runService.saveWorkflow({
      workflowId: body.workflowId,
      projectId: body.projectId,
      name: body.name ?? "",
      description: body.description,
      rootTaskInput: body.rootTaskInput,
      versionLabel: body.versionLabel,
      versionNotes: body.versionNotes,
      nodes: body.nodes ?? [],
      edges: body.edges ?? [],
      tasks: body.tasks ?? [],
    });
    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "保存工作流失败";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
