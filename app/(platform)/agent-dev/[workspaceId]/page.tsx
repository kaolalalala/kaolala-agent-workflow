import { DevWorkspaceShell } from "./dev-workspace-shell";

interface AgentDevWorkspacePageProps {
  params: Promise<{
    workspaceId: string;
  }>;
  searchParams: Promise<{
    entryFile?: string;
    runCommand?: string;
  }>;
}

export default async function AgentDevWorkspacePage({ params, searchParams }: AgentDevWorkspacePageProps) {
  const { workspaceId } = await params;
  const { entryFile, runCommand } = await searchParams;

  return (
    <DevWorkspaceShell
      workspaceId={workspaceId}
      initialEntryFile={entryFile}
      initialRunCommand={runCommand}
    />
  );
}
