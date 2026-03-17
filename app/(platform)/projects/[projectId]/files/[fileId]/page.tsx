import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";

import { runService } from "@/server/api/run-service";

interface ProjectFileDetailPageProps {
  params: Promise<{
    projectId: string;
    fileId: string;
  }>;
}

export default async function ProjectFileDetailPage({ params }: ProjectFileDetailPageProps) {
  const { projectId, fileId } = await params;

  let file: ReturnType<typeof runService.getProjectFile>["file"];
  try {
    file = runService.getProjectFile(projectId, fileId).file;
  } catch {
    notFound();
  }

  return (
    <div className="space-y-4">
      <section className="rounded-xl border border-slate-200 bg-white px-4 py-3 shadow-[0_10px_24px_-20px_rgba(15,23,42,0.22)]">
        <Link href={`/projects/${projectId}`} className="inline-flex items-center gap-1 text-xs text-slate-500 transition hover:text-slate-700">
          <ArrowLeft className="h-3.5 w-3.5" />
          返回项目
        </Link>
        <h1 className="mt-1 text-base font-semibold text-slate-900">{file.name}</h1>
        <p className="text-xs text-slate-500">文件 ID：{file.id}</p>
        <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-slate-500">
          <span>类型：{file.type}</span>
          <span>来源：{file.sourceType}</span>
          <span>创建：{new Date(file.createdAt).toLocaleString()}</span>
          <span>更新：{new Date(file.updatedAt).toLocaleString()}</span>
          {file.workflowId ? (
            <Link href={`/projects/${projectId}/workflows/${file.workflowId}`} className="text-indigo-600 hover:text-indigo-700">
              查看来源工作流
            </Link>
          ) : null}
          {file.runId ? (
            <Link href={`/projects/${projectId}/runs/${file.runId}`} className="text-indigo-600 hover:text-indigo-700">
              查看来源运行
            </Link>
          ) : null}
        </div>
      </section>

      <section className="rounded-xl border border-slate-200 bg-white p-4">
        <h2 className="text-sm font-semibold text-slate-800">文件内容</h2>
        <div className="mt-2 max-h-[70vh] overflow-auto rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm text-slate-700">
          {file.contentJson !== undefined ? (
            <pre className="whitespace-pre-wrap break-words">{JSON.stringify(file.contentJson, null, 2)}</pre>
          ) : file.contentText ? (
            <pre className="whitespace-pre-wrap break-words">{file.contentText}</pre>
          ) : (
            <p className="text-slate-500">该文件暂不支持内容预览。</p>
          )}
        </div>
      </section>
    </div>
  );
}

