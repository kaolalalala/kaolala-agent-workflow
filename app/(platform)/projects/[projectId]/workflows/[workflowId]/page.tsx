import { redirect } from "next/navigation";

import { runService } from "@/server/api/run-service";

import { WorkflowEditorShell } from "./workflow-editor-shell";

interface WorkflowEditorPageProps {
  params: Promise<{
    projectId: string;
    workflowId: string;
  }>;
}

export default async function WorkflowEditorPage({ params }: WorkflowEditorPageProps) {
  const { projectId, workflowId } = await params;

  let projectName = "未命名项目";
  try {
    projectName = runService.getProject(projectId).project.name;
  } catch {
    redirect("/projects");
  }

  let workflowName = "未命名工作流";
  let workflowUpdatedAt = "";
  try {
    const workflow = runService.getProjectWorkflow(projectId, workflowId).workflow;
    workflowName = workflow.name;
    workflowUpdatedAt = workflow.updatedAt;
  } catch {
    redirect(`/projects/${projectId}`);
  }

  return (
    <WorkflowEditorShell
      projectId={projectId}
      workflowId={workflowId}
      projectName={projectName}
      workflowName={workflowName}
      workflowUpdatedAt={workflowUpdatedAt}
    />
  );
}
