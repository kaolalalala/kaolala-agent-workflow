import { notFound } from "next/navigation";

import { runService } from "@/server/api/run-service";

import { RunDetailClient } from "./run-detail-client";

interface RunDetailPageProps {
  params: Promise<{
    projectId: string;
    runId: string;
  }>;
}

export default async function RunDetailPage({ params }: RunDetailPageProps) {
  const { projectId, runId } = await params;

  let run: ReturnType<typeof runService.getProjectRunDetail>["run"];
  try {
    run = runService.getProjectRunDetail(projectId, runId).run;
  } catch {
    notFound();
  }

  return <RunDetailClient projectId={projectId} run={run} />;
}

